import {ConditionChain} from '../conditions/ConditionChain.js';
import {BorrowContract} from '../ownership/BorrowContract.js';
import {DefaultArgumentInference} from '../DefaultArgumentInference.js';
import {AssociatedConstant} from '../AssociatedConstant.js';
import {EnumRecordAnalyzer} from '../EnumRecordAnalyzer.js';
import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';

/** Types pattern projections and assigns consistent local slots to alternatives. */
export class PatternAnalyzer {
  static MAX_SOURCE_DEPTH = 128;
  constructor(analyzer) {
    this.analyzer = analyzer; this.sources = new WeakSet();
    this.mode = 'move'; this.depth = 0; this.automatic = new WeakSet();
  }

  /** Source-address metadata is compiler-owned even for injected ASTs. A match
   * may prepare the same HIR scrutinee in several arms: retain the verified
   * temporary, never an incoming AST's forged local slot. */
  prepareSource(pattern, type, context, source) {
    if (source && !this.sources.has(source)) {
      delete source.patternStorage; delete source.patternBorrowed;
      this.sources.add(source);
    }
    const borrowed = ConditionChain.bindings(pattern).filter(item => item.byRef);
    const pending = [{node: pattern, indirect: false, writable: !this.analyzer.sharedStorage(source)}];
    let dereferences = false, mutableStorage = false, work = 0;
    while (pending.length) {
      const {node, indirect, writable} = pending.pop();
      if (++work > 65_536) throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Reference pattern source exceeds its work budget', pattern.span);
      if (node.byRef && node.mutable) {
        if (indirect && !writable) throw new Diagnostic('E0596', 'Cannot mutably borrow through a shared pattern reference', node.span);
        if (!indirect) mutableStorage = true;
      }
      if (node.kind === 'referencePattern') {
        dereferences = true;
        pending.push({node: node.pattern, indirect: true, writable: writable && node.mutable});
      } else {
        for (const child of [node.binder, node.kind === 'atPattern' ? node.pattern : null,
          ...(node.items ?? []), ...(node.fields ?? []).map(f => f.pattern), node.restBinding?.binder])
          if (child) pending.push({node: child, indirect, writable});
      }
    }
    if (!borrowed.length && !dereferences) return;
    const analyzer = this.analyzer;
    for (const item of borrowed) {
      let contained = item.type, depth = 0;
      while (T.reference(contained) && contained !== '&str') {
        if (++depth > PatternAnalyzer.MAX_SOURCE_DEPTH)
          throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Reference pattern type exceeds its depth budget', item.span);
        contained = T.target(contained);
      }
      if (item.mutable && BorrowContract.reference(item.type))
        throw new Diagnostic('F_PATTERN_BORROW', 'Mutable reference-storage bindings need assignment-aware inner-region tracking', item.span);
      if (ConditionChain.containsReferences(analyzer, contained))
        throw new Diagnostic('F_PATTERN_BORROW', 'Borrowing an aggregate reference carrier requires tracked field-region origins', item.span);
    }
    if (!source) throw new Diagnostic('F_PATTERN_BORROW', 'This pattern context needs an explicit source place for reference bindings', pattern.span);
    if (this.isPlace(source)) analyzer.place(source, context, mutableStorage);
    else if (!source.patternStorage) source.patternStorage = context.declare(`$pattern${source.id}`, type, true, source);
    source.patternBorrowed = true;
  }
  isPlace(source) {
    let node = source, depth = 0;
    while (node) {
      if (++depth > PatternAnalyzer.MAX_SOURCE_DEPTH)
        throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Reference pattern address exceeds its depth budget', source.span);
      if (node.kind === 'variable') return !!node.binding && !node.constant;
      if (node.kind === 'unary' && node.op === '*') return true;
      if (!['field', 'index'].includes(node.kind)) return false;
      if (node.autoDeref) return true;
      node = node.object;
    }
    return false;
  }

  constant(pattern, context, required) {
    const a = this.analyzer, module = context.instance.fn.module;
    const global = a.index.resolve(a.index.constants, pattern.name, module, pattern, false);
    if (global) return a.constants.constant(global, pattern).expression;
    if (pattern.name.includes('::') || pattern.qualifiedTrait) {
      // Constructor resolution must retain its own diagnostics and visibility.
      if (a.index.constructorFor(pattern.name, module, pattern)) return null;
      const resolved = a.implementations.associated(pattern, context);
      if (resolved?.fn.associatedConstant) return AssociatedConstant.evaluate(a, resolved, pattern, context).expression;
    }
    if (required) throw new Diagnostic('E0158', 'Expected a scalar constant path', pattern.span);
    return null;
  }

  constructorArguments(pattern, owner, type, context) {
    if (!pattern.ownerTypeArguments) return;
    const supplied = pattern.ownerTypeArguments.map(argument => this.analyzer.normalize(argument,context,pattern));
    const actual = T.application(type).args;
    const defaults = new DefaultArgumentInference(this.analyzer.index,owner,supplied,actual,pattern,context.instance.fn.module);
    owner.generics.forEach((generic,index)=>T.unify(actual[index],defaults.mapping.get(generic.name) ?? '_',new Map(),pattern));
  }

  analyze(pattern, type, context, mutable = false, bindings = new Map(), names = new Set(), reuse = false, mode = this.mode) {
    if (this.depth >= PatternAnalyzer.MAX_SOURCE_DEPTH)
      throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Reference pattern analysis exceeds its depth budget', pattern?.span);
    this.depth++;
    const previous = this.mode; this.mode = mode;
    try { return this.analyzeInner(pattern, type, context, mutable, bindings, names, reuse); }
    finally { this.mode = previous; this.depth--; }
  }

  analyzeInner(pattern, type, context, mutable, bindings, names, reuse) {
    if (pattern.byRef !== undefined && (typeof pattern.byRef !== 'boolean' || pattern.kind !== 'bindingPattern'))
      throw new Diagnostic('F_PATTERN', 'Invalid reference binding mode', pattern.span);
    if (pattern.byRef && pattern.mutable !== undefined && typeof pattern.mutable !== 'boolean')
      throw new Diagnostic('F_PATTERN', 'Invalid reference binding mutability', pattern.span);
    pattern.type = type;
    if (pattern.kind === 'variantPattern' && !pattern.items.length) {
      const literal = this.constant(pattern, context, false);
      if (literal) {
        T.unify(type, literal.type, new Map(), pattern);
        if (pattern.tupleSyntax) throw new Diagnostic('E0532', 'A constant pattern cannot use constructor parentheses', pattern.span);
        if (literal.kind !== 'literal') throw new Diagnostic('F_PATTERN_CONST', 'Aggregate constant patterns require structural equality support', pattern.span);
        pattern.kind = 'literal'; pattern.value = literal.value; pattern.type = literal.type;
      }
    }
    // Default binding modes are declaration-local, lexical state. An implicit
    // dereference is materialized in typed HIR, never in the caller's source AST.
    // Bare bindings, @ binders and alternatives decide their own matching mode.
    if (BorrowContract.reference(type) && !['wildcard', 'bindingPattern', 'atPattern', 'orPattern', 'referencePattern'].includes(pattern.kind)) {
      const inner = {...pattern, id: `${pattern.id}:referent`};
      for (const key of Object.keys(pattern)) if (!['id', 'span', 'loc'].includes(key)) delete pattern[key];
      Object.assign(pattern, {kind: 'referencePattern', type, mutable: type.startsWith('&mut '), pattern: inner});
      this.automatic.add(pattern);
    }
    switch (pattern.kind) {
      case 'referencePattern': {
        if (!pattern.pattern || typeof pattern.pattern !== 'object' ||
            pattern.mutable !== undefined && typeof pattern.mutable !== 'boolean')
          throw new Diagnostic('F_PATTERN', 'Malformed reference pattern', pattern.span);
        const automatic = this.automatic.has(pattern);
        if (!automatic && this.mode !== 'move')
          throw new Diagnostic('E0003', 'A Rust 2024 reference pattern requires a fully explicit prefix', pattern.span);
        if (!BorrowContract.reference(type) || !!pattern.mutable !== type.startsWith('&mut '))
          throw new Diagnostic('E0308', `Reference pattern mutability or type does not match ${type}`, pattern.span);
        // A shared edge is sticky: descending through &mut behind & cannot
        // recover unique access. Explicit prefixes reset to by-value binding.
        const mode = automatic ? this.mode === 'ref' || !pattern.mutable ? 'ref' : 'ref mut' : 'move';
        this.analyze(pattern.pattern, T.target(type), context, mutable, bindings, names, reuse, mode);
        return;
      }
      case 'wildcard': return;
      case 'restPattern': throw new Diagnostic('E0797', "'..' is only valid within an array, tuple or tuple-variant pattern", pattern.span);
      case 'atPattern': {
        this.analyze(pattern.binder, type, context, mutable, bindings, names, reuse);
        if (pattern.binder.kind !== 'bindingPattern') throw new Diagnostic('E0530', "Expected a new binding before '@'", pattern.binder.span);
        this.analyze(pattern.pattern, type, context, mutable, bindings, names, reuse);
        const copy = this.analyzer.hasTrait(pattern.binder.binding.type, 'Copy');
        if (!pattern.binder.byRef && !copy && this.hasNonCopyBinding(pattern.pattern)) {
          throw new Diagnostic('E0382', "An '@' pattern cannot move both the whole value and a non-Copy part", pattern.span);
        }
        pattern.binder.copy = copy;
        return;
      }
      case 'bindingPattern': {
        if (pattern.byRef && mutable) throw new Diagnostic('E0003', 'A ref binding cannot have an outer mut modifier', pattern.span);
        const index = this.analyzer.index;
        const constant = index.resolve(index.constants, pattern.name, context.instance.fn.module, pattern, false);
        const constructor = index.constructorFor(pattern.name, context.instance.fn.module);
        if (constant || constructor) {
          if (pattern.mutable || pattern.byRef) throw new Diagnostic('E0530', 'A binding cannot shadow a constant or enum constructor', pattern.span);
          if (constructor) {
            pattern.kind = 'variantPattern'; pattern.items = []; pattern.tupleSyntax = false;
          } else {
            const literal = structuredClone(this.analyzer.constants.constant(constant, pattern).expression);
            T.unify(type, literal.type, new Map(), pattern);
            if (literal.kind !== 'literal') throw new Diagnostic('F_PATTERN_CONST', 'Aggregate constant patterns require structural equality support', pattern.span);
            pattern.kind = 'literal'; pattern.value = literal.value; pattern.type = literal.type;
          }
          return this.analyze(pattern, type, context, mutable, bindings, names, reuse);
        }
        const writtenMode = pattern.byRef ? pattern.mutable ? 'ref mut' : 'ref' : pattern.mutable || mutable ? 'mut' : 'value';
        if (this.mode !== 'move') {
          if (pattern.byRef || pattern.mutable || mutable)
            throw new Diagnostic('E0003', 'Rust 2024 binding modifiers require a fully explicit pattern prefix', pattern.span);
          pattern.byRef = true; pattern.mutable = this.mode === 'ref mut';
        }
        if (names.has(pattern.name)) throw new Diagnostic('E0416', `Identifier '${pattern.name}' is bound more than once in this pattern`, pattern.span);
        names.add(pattern.name);
        const mode = !pattern.byRef && (mutable || !!pattern.mutable);
        const bindingType = pattern.byRef ? '&' + (pattern.mutable ? 'mut ' : '') + type : type;
        const bindingMode = pattern.byRef ? pattern.mutable ? 'ref mut' : 'ref' : 'value';
        if (reuse) {
          const binding = bindings.get(pattern.name);
          if (!binding) throw new Diagnostic('E0408', `Variable '${pattern.name}' is not bound in all alternatives`, pattern.span);
          T.unify(binding.type, bindingType, new Map(), pattern);
          if ((binding.patternMode ?? 'value') !== bindingMode || binding.mutable !== mode || binding.patternWrittenMode !== writtenMode) throw new Diagnostic('E0409', `Inconsistent binding mode for '${pattern.name}'`, pattern.span);
          pattern.binding = binding;
        } else {
          pattern.binding = context.declare(pattern.name, bindingType, mode, pattern);
          if (pattern.byRef) pattern.binding.patternMode = bindingMode;
          pattern.binding.patternWrittenMode = writtenMode;
          bindings.set(pattern.name, pattern.binding);
        }
        return;
      }
      case 'literal': case 'unary': {
        T.unify(type, this.analyzer.infer(pattern, context, type), new Map(), pattern);
        if (!T.integer(type) && !['bool', 'char', '&str'].includes(type)) throw new Diagnostic('E0158', `Unsupported constant pattern type ${type}`, pattern.span);
        return;
      }
      case 'rangePattern': {
        if (!T.integer(type) && type !== 'char') throw new Diagnostic('E0029', 'Range patterns require integer or character endpoints', pattern.span);
        const bits = type.endsWith('size') ? 32 : Number(type.slice(1));
        const signed = type[0] === 'i';
        const min = type === 'char' ? '\0' : String(signed ? -(1n << BigInt(bits - 1)) : 0n);
        const max = type === 'char' ? String.fromCodePoint(0x10ffff) : String((1n << BigInt(bits - (signed ? 1 : 0))) - 1n);
        if (!pattern.from) pattern.from = {kind: 'literal', value: min, type, span: pattern.span};
        if (!pattern.to) { pattern.to = {kind: 'literal', value: max, type, span: pattern.span}; pattern.inclusive = true; }
        for (const key of ['from', 'to']) {
          const endpoint = pattern[key];
          if (endpoint.kind === 'bindingPattern' || endpoint.kind === 'variantPattern') {
            pattern[key] = structuredClone(this.constant(endpoint, context, true));
          }
          T.unify(type, this.analyzer.infer(pattern[key], context, type), new Map(), pattern[key]);
          if (pattern[key].kind !== 'literal') throw new Diagnostic('E0158', 'Range endpoint must be a scalar constant', endpoint.span);
        }
        const scalar = p => type === 'char' ? BigInt(p.value.codePointAt(0)) : BigInt(p.value);
        if (pattern.inclusive ? scalar(pattern.from) > scalar(pattern.to) : scalar(pattern.from) >= scalar(pattern.to)) {
          throw new Diagnostic('E0030', 'Range pattern has an empty interval', pattern.span);
        }
        return;
      }
      case 'orPattern': {
        const baseline = new Set(names);
        let expected;
        for (const [i, alternative] of pattern.items.entries()) {
          const bound = new Set(baseline);
          this.analyze(alternative, type, context, mutable, bindings, bound, reuse || i > 0);
          if (i === 0) expected = bound;
          else if (bound.size !== expected.size || [...expected].some(name => !bound.has(name))) {
            throw new Diagnostic('E0408', 'Every alternative must bind the same variables', alternative.span);
          }
        }
        for (const name of expected) names.add(name);
        return;
      }
      case 'tuplePattern': {
        const parts = type.startsWith('(') ? T.split(type.slice(1, -1)) : [];
        this.expandRest(pattern, parts.length, 'E0527');
        pattern.items.forEach((p, i) => this.analyze(p, parts[i], context, mutable, bindings, names, reuse));
        return;
      }
      case 'arrayPattern': {
        const array = T.array(type);
        if (!array) throw new Diagnostic('E0529', `Array pattern cannot match ${type}`, pattern.span);
        const length = Number(array.length);
        if (!Number.isSafeInteger(length) || length < 0 || length > 100000) throw new Diagnostic('F_PATTERN_BUDGET', 'Array pattern exceeds the compiler element budget', pattern.span);
        this.expandRest(pattern, length, 'E0527', true);
        for (const item of pattern.items) this.analyze(item, array.element, context, mutable, bindings, names, reuse);
        if (pattern.restBinding) this.analyze(pattern.restBinding.binder, `[${array.element};${pattern.restBinding.length}]`, context, mutable, bindings, names, reuse);
        if (pattern.restBinding?.binder.byRef) throw new Diagnostic('F_PATTERN_BORROW', 'A borrowed array-rest binding requires subarray reference storage', pattern.restBinding.binder.span);
        return;
      }
      case 'structPattern': {
        const constructor = this.analyzer.index.constructorFor(pattern.name.startsWith('Self::') ? context.instance.fn.owner + pattern.name.slice(4) : pattern.name, context.instance.fn.module, pattern);
        if (constructor?.kind === 'enum') this.constructorArguments(pattern, constructor.owner, type, context);
        if (constructor?.kind === 'enum') return EnumRecordAnalyzer.pattern(this.analyzer, pattern, constructor, type, context, mutable, bindings, names, reuse);
        const index = this.analyzer.index, module = context.instance.fn.module;
        const direct = index.resolve(index.structs,pattern.name,module,pattern,false);
        const alias = index.resolve(index.aliases,pattern.name,module,pattern,false);
        const spelling = alias?.generics.length ? `${pattern.name}<${alias.generics.map(()=>'_').join(',')}>` : pattern.name;
        const shape = direct ?? index.resolve(index.structs,T.application(index.type(spelling,module,context.instance.fn.owner)).name,module,pattern);
        const app = T.application(type);
        if (app.name !== shape.name) throw new Diagnostic('E0308', `Pattern ${shape.name} does not match ${type}`, pattern.span);
        this.constructorArguments(pattern, shape, type, context);
        const substitution = new Map(shape.generics.map((g, i) => [g.name, app.args[i]]));
        const fields = new Set();
        for (const field of pattern.fields) {
          const definition = this.analyzer.index.field(shape, field.name);
          if (!definition || fields.has(field.name)) throw new Diagnostic('E0025', `Unknown or duplicate field ${field.name}`, pattern.span);
          fields.add(field.name);
          this.analyzer.index.fieldVisible(shape, definition, context.instance.fn.module, field.pattern);
          const fieldType = this.analyzer.index.instantiatedType(definition.type, shape, substitution, pattern);
          this.analyze(field.pattern, fieldType, context, mutable, bindings, names, reuse);
        }
        if (!pattern.rest && fields.size !== shape.fields.length) throw new Diagnostic('E0027', `Pattern ${shape.name} must mention every field or use '..'`, pattern.span);
        pattern.name = shape.name;
        return;
      }
      case 'variantPattern': {
        const constructor = this.analyzer.index.constructorFor(pattern.name === 'Self' ? context.instance.fn.owner : pattern.name.startsWith('Self::') ? context.instance.fn.owner + pattern.name.slice(4) : pattern.name, context.instance.fn.module, pattern);
        const app = T.application(type);
        if (!constructor || constructor.owner.name !== app.name) throw new Diagnostic('E0532', `Pattern ${pattern.name} does not match ${type}`, pattern.span);
        this.constructorArguments(pattern, constructor.owner, type, context);
        if (constructor.kind === 'struct') {
          if (Boolean(pattern.tupleSyntax) !== (constructor.form === 'tuple'))
            throw new Diagnostic('E0532', `Expected ${constructor.form === 'tuple' ? 'tuple' : 'unit'} constructor pattern for ${pattern.name}`, pattern.span);
          if (constructor.form === 'tuple') for (const field of constructor.owner.fields)
            this.analyzer.index.fieldVisible(constructor.owner, field, context.instance.fn.module, pattern);
          this.expandRest(pattern, constructor.owner.fields.length, 'E0023');
          pattern.kind = 'structPattern'; pattern.name = constructor.owner.name;
          pattern.fields = pattern.items.flatMap((item, i) => item.kind === 'wildcard' ? [] : [{name: String(i), pattern: item}]);
          pattern.rest = true; delete pattern.items;
          return this.analyze(pattern, type, context, mutable, bindings, names, reuse);
        }
        if (!pattern.recordSyntax && Boolean(pattern.tupleSyntax) !== (constructor.form === 'tuple') || constructor.form === 'record' && !pattern.recordSyntax)
          throw new Diagnostic('E0532', `Expected ${constructor.form} pattern for ${constructor.tag}`, pattern.span);
        this.expandRest(pattern, constructor.variant.fields.length, 'E0023');
        const substitution = new Map(constructor.owner.generics.map((g, i) => [g.name, app.args[i]]));
        pattern.variant = constructor.tag;
        pattern.items.forEach((p, i) => this.analyze(p, this.analyzer.index.instantiatedType(constructor.variant.fields[i], constructor.owner, substitution, pattern), context, mutable, bindings, names, reuse));
        return;
      }
      default: throw new Diagnostic('F_PATTERN', `Pattern '${pattern.kind}' has no type rule`, pattern.span);
    }
  }

  /** Rest syntax is normalized once; predicates/coverage operate on typed projections. */
  expandRest(pattern, arity, code, array = false) {
    const restIndices = pattern.items.flatMap((p, i) => p.kind === 'restPattern' || p.kind === 'atPattern' && p.pattern.kind === 'restPattern' ? [i] : []);
    if (restIndices.length > 1) throw new Diagnostic('E0528', "Only one '..' may occur in a sequence pattern", pattern.span);
    if (!restIndices.length) {
      if (pattern.items.length !== arity) throw new Diagnostic(code, 'Pattern arity does not match the value', pattern.span);
      return;
    }
    const index = restIndices[0], rest = pattern.items[index], length = arity - pattern.items.length + 1;
    if (length < 0) throw new Diagnostic(code, 'Pattern has more elements than the value', pattern.span);
    if (rest.kind === 'atPattern') {
      if (!array) throw new Diagnostic('E0308', "A binding to '..' is only valid in an array pattern", rest.span);
      pattern.restBinding = {binder: rest.binder, start: index, length};
    }
    pattern.restSpan = rest.span;
    pattern.items = [...pattern.items.slice(0, index), ...Array.from({length}, (_, i) => ({kind: 'wildcard', id: `${rest.id}:rest:${i}`, span: rest.span})), ...pattern.items.slice(index + 1)];
  }

  hasNonCopyBinding(pattern) {
    if (pattern.binding && !pattern.byRef && !this.analyzer.hasTrait(pattern.binding.type, 'Copy')) return true;
    if (pattern.kind === 'atPattern') return this.hasNonCopyBinding(pattern.binder) || this.hasNonCopyBinding(pattern.pattern);
    if (pattern.kind === 'referencePattern') return this.hasNonCopyBinding(pattern.pattern);
    if (pattern.items?.some(p => this.hasNonCopyBinding(p))) return true;
    if (pattern.fields?.some(f => this.hasNonCopyBinding(f.pattern))) return true;
    return pattern.restBinding ? this.hasNonCopyBinding(pattern.restBinding.binder) : false;
  }

}
