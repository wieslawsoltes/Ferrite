import {Diagnostic} from './Diagnostic.js';
import {ImplObligations} from './ImplObligations.js';
import {TraitMethodScope} from './TraitMethodScope.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Proves scalar constant patterns independent of their symbolic type arguments.
 * An implementing type containing T is not itself a value dependency. Conversely,
 * specializing T::N first would hide an illegal dependency, even in a dead arm.
 * This proof uses declaration origins and isolated, type-only checked bodies.
 */
export class ConstantPatternProof {
  static parameters(type, parameters) {
    return [...parameters].filter(name => T.substitute(type ?? '', new Map([[name, '_']])) !== (type ?? ''));
  }

  static origin(a, resolved, node, context) {
    const scope = context.methodScope, {fn} = resolved;
    let owner = node.qualifiedSelf ?? node.name.slice(0, node.name.lastIndexOf('::'));
    if (node.ownerTypeArguments) owner += `<${node.ownerTypeArguments.join(',')}>`;
    owner = scope.normalize(owner);
    const trait = node.qualifiedTrait ? a.implementations.traits.hierarchy.canonical(
      node.qualifiedTrait, scope.fn.module, node, scope.parameters, owner) : null;
    const used = this.parameters([owner, trait].filter(Boolean).join(','), scope.parameters);
    if (!used.length) return {selectionParameters: [], argumentParameters: fn.generics.map(() => [])};
    const dependent = () => ({selectionParameters: used, argumentParameters: fn.generics.map(() => used)});
    // Trait selection for a bare symbolic self type is not known before
    // monomorphization, even when the chosen concrete impl has a literal value.
    if (scope.parameters.has(owner)) return dependent();
    const entry = a.implementations.entries[fn.implIndex];
    if (!entry) return dependent();
    const mapping = trait ? a.implementations.traits.match(entry, owner, trait) : a.implementations.match(entry, owner);
    if (!mapping) return dependent();
    const environment = new ImplObligations(a, {target: scope.fn.owner ?? null}, scope.fn);
    if (!a.implementations.applicable(entry, mapping, (type, bound) => environment.prove(type, bound))) return dependent();
    for (const [name, value] of fn.defaultArguments ?? []) mapping.set(name, T.substitute(value, mapping));
    return {selectionParameters: [], argumentParameters: fn.generics.map(g =>
      mapping.get(g.name) === null || mapping.get(g.name) === undefined ? used : this.parameters(mapping.get(g.name), scope.parameters))};
  }

  static check(analyzer, resolved, node, context, arguments_) {
    const origin = this.origin(analyzer, resolved, node, context);
    if (origin.selectionParameters.length) this.reject(node);
    const unknown = resolved.fn.generics.filter((g, i) => origin.argumentParameters[i]?.length).map(g => g.name);
    if (!unknown.length) return;
    const identity = JSON.stringify([resolved.fn.name, arguments_, unknown]);
    const proofs = analyzer.constants.patternProofs ??= new Set();
    if (proofs.has(identity)) return;
    const proof = new this(analyzer, node);
    proof.visit(resolved.fn.name, arguments_, new Set(unknown));
    analyzer.constants.evaluations += proof.visits + proof.a.constants.evaluations;
    analyzer.constants.steps += proof.a.constants.steps;
    if (analyzer.constants.evaluations > analyzer.constants.maxExpressions || analyzer.constants.steps > analyzer.constants.maxSteps)
      throw new Diagnostic('F_CONST_BUDGET', 'Constant pattern dependency budget exceeded', node.span);
    proofs.add(identity);
  }

  static reject(node) {
    throw new Diagnostic('E0158', 'Constant pattern value depends on a generic type parameter', node.span);
  }

  constructor(analyzer, node) {
    this.node = node; this.visits = 0; this.depth = 0; this.seen = new Set();
    this.a = new analyzer.constructor(analyzer.ast, {mode: 'library', maxInstances: analyzer.maxInstances,
      constEvaluation: analyzer.constEvaluationOptions});
    this.a.constants.checkingDefinition = true;
    this.a.constants.provingPattern = true;
  }

  visit(name, arguments_, unknown, instance = null) {
    if (++this.depth > 128) throw new Diagnostic('F_CONST_BUDGET', 'Constant pattern dependency recursion exceeded', this.node.span);
    try { return this.visitBody(name, arguments_, unknown, instance); }
    finally { this.depth--; }
  }

  visitBody(name, arguments_, unknown, instance) {
    if (!unknown.size) return;
    const identity = JSON.stringify([name, arguments_, [...unknown].sort()]);
    if (this.seen.has(identity)) return;
    if (++this.visits > this.a.constants.maxExpressions || this.seen.size >= this.a.maxInstances)
      throw new Diagnostic('F_CONST_BUDGET', 'Constant pattern dependency budget exceeded', this.node.span);
    this.seen.add(identity);
    const fn = this.a.index.functions.get(name) ?? instance?.fn;
    if (!fn) throw new Diagnostic('F_CONST_MIR', 'Missing constant pattern declaration', this.node.span);
    instance ??= this.a.instantiate(fn, [], arguments_, this.node);
    this.a.constants.validate(instance);
    const substitution = new Map(Object.entries(instance.typeArguments));
    const context = {instance: {...instance, substitution}, methodScope: new TraitMethodScope(this.a, fn, substitution)};
    const intersects = names => names.some(name => unknown.has(name));
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (node.kind === 'constantReference') {
        if (intersects(node.selectionParameters)) this.constructor.reject(this.node);
        const target = this.a.index.functions.get(node.name);
        this.visit(node.name, node.arguments, new Set(target.generics.filter((g, i) => intersects(node.argumentParameters[i] ?? [])).map(g => g.name)));
        return;
      }
      if (node.resolved) {
        const target = this.a.instances.get(node.resolved), declaration = this.a.index.functions.get(target?.name) ?? target?.fn;
        if (!target || !declaration) throw new Diagnostic('F_CONST_MIR', 'Missing constant pattern callee', node.span);
        let origins;
        const callee = node.callee;
        if (callee?.name?.includes('::')) {
          const resolved = this.a.implementations.associated(callee, context);
          if (resolved) {
            const origin = this.constructor.origin(this.a, resolved, callee, context);
            if (intersects(origin.selectionParameters)) this.constructor.reject(this.node);
            origins = origin.argumentParameters;
          }
        }
        origins ??= declaration.generics.map((g, i) => {
          const explicit = callee?.typeArguments?.[i];
          if (explicit) return this.constructor.parameters(context.methodScope.normalize(explicit), unknown);
          // Retain parameter origins for inferred calls; unknown non-parameter
          // local origins are conservative rather than guessed from concrete T.
          return [...unknown];
        });
        this.visit(declaration.name, declaration.generics.map(g => target.typeArguments[g.name]),
          new Set(declaration.generics.filter((g, i) => intersects(origins[i] ?? [])).map(g => g.name)), target);
      }
      for (const [key, value] of Object.entries(node)) if (!['span', 'loc', 'binding'].includes(key)) walk(value);
    };
    walk(instance.fn.body);
  }
}
