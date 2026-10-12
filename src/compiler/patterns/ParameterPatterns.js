import {ConditionChain} from '../conditions/ConditionChain.js';
import {Diagnostic} from '../Diagnostic.js';

/** Destructure incoming ABI slots using the ordinary checked pattern pipeline.
 * Source parameter patterns are never rewritten into identifier substitutions.
 * The compiler-owned prologue participates in the same local liveness, move,
 * reborrow, return-contract and MIR passes as source-local bindings. */
export class ParameterPatterns {
  static MAX_PARAMETERS = 1024;
  static MAX_PATTERN_NODES = 65_536;
  static MAX_PATTERN_DEPTH = 128;

  static checkCount(declaration) {
    if (declaration.params.length > this.MAX_PARAMETERS)
      throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Function parameters exceed the binding budget', declaration.span);
    for (const parameter of declaration.params) {
      if (parameter.pattern && parameter.name != null || !parameter.pattern &&
          (typeof parameter.name !== 'string' || !/^[\p{XID_Start}_][\p{XID_Continue}]*$/u.test(parameter.name)))
        throw new Diagnostic('F_PARAMETER_PATTERN', 'Inconsistent parameter pattern/name metadata', parameter.span);
    }
  }

  static clean(pattern, budget) {
    const pending = [[pattern, 0]], seen = new Set();
    while (pending.length) {
      const [node, depth] = pending.pop();
      if (++budget.work > this.MAX_PATTERN_NODES || depth > this.MAX_PATTERN_DEPTH)
        throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Parameter patterns exceed the traversal budget', pattern.span);
      if (!node || typeof node !== 'object' || Array.isArray(node) || seen.has(node))
        throw new Diagnostic('F_PARAMETER_PATTERN', 'Malformed or cyclic parameter pattern', pattern.span);
      seen.add(node);
      if (node.kind === 'bindingPattern' && (typeof node.name !== 'string' || !/^[\p{XID_Start}_][\p{XID_Continue}]*$/u.test(node.name)))
        throw new Diagnostic('F_PARAMETER_PATTERN', 'Invalid parameter binding name', node.span);
      for (const key of ['binding', 'copy', 'restBinding', 'patternStorage', 'patternBorrowed', 'autoDeref', 'variant']) delete node[key];
      const append = child => pending.push([child, depth + 1]);
      if (['tuplePattern', 'arrayPattern', 'orPattern', 'variantPattern'].includes(node.kind)) {
        if (!Array.isArray(node.items)) throw new Diagnostic('F_PARAMETER_PATTERN', 'Parameter pattern requires an item list', node.span);
        node.items.forEach(append);
      } else if (node.kind === 'structPattern') {
        if (!Array.isArray(node.fields)) throw new Diagnostic('F_PARAMETER_PATTERN', 'Record parameter pattern requires fields', node.span);
        for (const field of node.fields) {
          if (!field || typeof field.name !== 'string') throw new Diagnostic('F_PARAMETER_PATTERN', 'Malformed parameter field', node.span);
          append(field.pattern);
        }
      } else if (node.kind === 'referencePattern') append(node.pattern);
      else if (node.kind === 'atPattern') { append(node.binder); append(node.pattern); }
      else if (node.kind === 'rangePattern') { if (node.from) append(node.from); if (node.to) append(node.to); }
      else if (node.kind === 'unary') append(node.value);
      else if (!['literal', 'bindingPattern', 'wildcard', 'restPattern'].includes(node.kind))
        throw new Diagnostic('F_PARAMETER_PATTERN', 'Unsupported parameter pattern node', node.span);
    }
    return pattern;
  }

  static bind(analyzer, declaration, instance, context, argumentTypes) {
    const parameters = instance.fn.params;
    this.checkCount(declaration);
    const budget = {work: 0};
    const origins = [], patterns = [], names = new Map();
    // Allocate all incoming slots first. Pattern locals are not ABI arguments,
    // and the argument index used by BorrowContract must stay independent of
    // how many bindings a preceding parameter introduces.
    for (let index = 0; index < parameters.length; index++) {
      const parameter = parameters[index], source = declaration.params[index];
      parameter.type = argumentTypes[index];
      const original = parameter.pattern ? this.clean(parameter.pattern, budget) : {kind: source.name === '_' ? 'wildcard' : 'bindingPattern',
        name: source.name, mutable: !!source.mutable, id: `${source.id}:pattern`, span: source.span, loc: source.loc};
      const resolvedName = original.kind === 'bindingPattern' && !original.byRef ? original.name : null;
      const constant = resolvedName && (analyzer.index.resolve(analyzer.index.constants, resolvedName,
        declaration.module, source, false) || analyzer.index.constructorFor(resolvedName, declaration.module));
      const simple = resolvedName != null && !constant && !source.pattern;
      if (resolvedName === 'self' && (index !== 0 || !declaration.owner || source.name !== 'self'))
        throw new Diagnostic('E0424', 'A self receiver must be the first parameter of an associated function', source.span);
      const name = simple ? resolvedName : `$argument${index}`;
      parameter.binding = context.declare(name, parameter.type, simple ? !!original.mutable : true, parameter, true);
      const closure = context.methodScope.closure;
      const origin = declaration.generatedClosure && index > 0 && closure?.parameterOrigins?.[index - 1] ||
        context.methodScope.normalize(source.type);
      origins.push(origin); context.methodScope.bind(parameter.binding, origin);
      patterns.push(simple ? null : original);
      if (simple) this.unique(names, name, parameter.binding, source);
    }
    const prologue = [];
    for (let index = 0; index < parameters.length; index++) {
      const parameter = parameters[index];
      if (!patterns[index]) continue;
      // This clone is owned by the current instantiation. Ignore any incoming
      // binding/address metadata: inference and PatternAnalyzer rebuild it.
      const pattern = patterns[index];
      const value = {kind: 'variable', name: parameter.binding.name,
        id: `${parameter.id}:input`, span: parameter.span, loc: parameter.loc};
      analyzer.infer(value, context);
      const previous = context.inferredParameterPattern;
      const closure = context.methodScope.closure;
      context.inferredParameterPattern = !!(closure?.parametersFromCall && index > 0 && !closure.node.params[index - 1].type);
      try { analyzer.pattern(pattern, parameter.type, context, false, origins[index], value); }
      catch (error) {
        if (error.code === 'E0416') throw new Diagnostic('E0415', error.message, error.span, error.notes);
        throw error;
      } finally { context.inferredParameterPattern = previous; }
      // Unannotated closure signatures inferred after declaration carry fixed
      // input regions, unlike independently annotated reference parameters.
      // Until those type-owned regions can retain loans across closure calls,
      // do not authorize newly destructured reference carriers by erasing them.
      if (closure && index > 0 && !closure.node.params[index - 1].type &&
          pattern.kind !== 'wildcard' && ConditionChain.containsReferences(analyzer, parameter.type))
        throw new Diagnostic('F_CLOSURE_INPUT_REGION', 'An unannotated reference-carrying closure pattern needs type-owned input-region tracking; add an explicit parameter type', parameter.span);
      const coverage = analyzer.checkCoverage([pattern], parameter.type, parameter);
      if (!coverage.exhaustive) throw new Diagnostic('E0005',
        `Refutable pattern in function parameter; missing ${coverage.witness}`, parameter.span);
      for (const binding of new Set(ConditionChain.bindings(pattern).map(node => node.binding))) {
        if (binding.name === 'self') throw new Diagnostic('E0424', 'self cannot be introduced by a destructuring pattern', binding.span);
        this.unique(names, binding.name, binding, parameter);
      }
      parameter.pattern = pattern;
      prologue.push({kind: 'let', id: `${parameter.id}:entry`, span: parameter.span, loc: parameter.loc,
        pattern, value, binding: null, mutable: false, annotation: null, otherwise: null, type: '()'});
    }
    return prologue;
  }

  static unique(names, name, binding, node) {
    const previous = names.get(name);
    if (previous && previous !== binding)
      throw new Diagnostic('E0415', `Identifier '${name}' is bound more than once in the parameter list`, node.span,
        [{message: 'Previous parameter binding', span: previous.span}]);
    names.set(name, binding);
  }
}
