import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';

/** Types pattern projections and assigns consistent local slots to alternatives. */
export class PatternAnalyzer {
  constructor(analyzer) { this.analyzer = analyzer; }

  analyze(pattern, type, context, mutable = false, bindings = new Map(), names = new Set(), reuse = false) {
    pattern.type = type;
    if (pattern.kind === 'variantPattern' && !pattern.items.length) {
      const constant = this.analyzer.index.resolve(this.analyzer.index.constants, pattern.name, context.instance.fn.module, pattern, false);
      if (constant) {
        const literal = this.analyzer.constants.constant(constant, pattern).expression;
        if (literal.kind !== 'literal') throw new Diagnostic('F_PATTERN_CONST', 'Aggregate constant patterns require structural equality support', pattern.span);
        pattern.kind = 'literal'; pattern.value = literal.value; pattern.type = literal.type;
      }
    }
    switch (pattern.kind) {
      case 'wildcard': return;
      case 'restPattern': throw new Diagnostic('E0797', "'..' is only valid within an array, tuple or tuple-variant pattern", pattern.span);
      case 'atPattern': {
        this.analyze(pattern.binder, type, context, mutable, bindings, names, reuse);
        if (pattern.binder.kind !== 'bindingPattern') throw new Diagnostic('E0530', "Expected a new binding before '@'", pattern.binder.span);
        this.analyze(pattern.pattern, type, context, mutable, bindings, names, reuse);
        const copy = this.analyzer.hasTrait(type, 'Copy');
        if (!copy && this.hasNonCopyBinding(pattern.pattern)) {
          throw new Diagnostic('E0382', "An '@' pattern cannot move both the whole value and a non-Copy part", pattern.span);
        }
        pattern.binder.copy = copy;
        return;
      }
      case 'bindingPattern': {
        const index = this.analyzer.index;
        const constant = index.resolve(index.constants, pattern.name, context.instance.fn.module, pattern, false);
        const constructor = index.constructorFor(pattern.name, context.instance.fn.module);
        if (constant || constructor) {
          if (pattern.mutable) throw new Diagnostic('E0530', 'A binding cannot shadow a constant or enum constructor', pattern.span);
          if (constructor) {
            pattern.kind = 'variantPattern'; pattern.items = []; pattern.tupleSyntax = false;
          } else {
            const literal = structuredClone(this.analyzer.constants.constant(constant, pattern).expression);
            if (literal.kind !== 'literal') throw new Diagnostic('F_PATTERN_CONST', 'Aggregate constant patterns require structural equality support', pattern.span);
            pattern.kind = 'literal'; pattern.value = literal.value; pattern.type = literal.type;
          }
          return this.analyze(pattern, type, context, mutable, bindings, names, reuse);
        }
        if (names.has(pattern.name)) throw new Diagnostic('E0416', `Identifier '${pattern.name}' is bound more than once in this pattern`, pattern.span);
        names.add(pattern.name);
        const mode = mutable || !!pattern.mutable;
        if (reuse) {
          const binding = bindings.get(pattern.name);
          if (!binding) throw new Diagnostic('E0408', `Variable '${pattern.name}' is not bound in all alternatives`, pattern.span);
          T.unify(binding.type, type, new Map(), pattern);
          if (binding.mutable !== mode) throw new Diagnostic('E0409', `Inconsistent binding mode for '${pattern.name}'`, pattern.span);
          pattern.binding = binding;
        } else {
          pattern.binding = context.declare(pattern.name, type, mode, pattern);
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
            const constant = this.analyzer.index.resolve(this.analyzer.index.constants, endpoint.name, context.instance.fn.module, endpoint);
            pattern[key] = structuredClone(this.analyzer.constants.constant(constant, endpoint).expression);
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
        return;
      }
      case 'structPattern': {
        const shape = this.analyzer.index.resolve(this.analyzer.index.structs, T.application(this.analyzer.index.type(pattern.name, context.instance.fn.module)).name, context.instance.fn.module, pattern);
        const app = T.application(type);
        if (app.name !== shape.name) throw new Diagnostic('E0308', `Pattern ${shape.name} does not match ${type}`, pattern.span);
        const substitution = new Map(shape.generics.map((g, i) => [g.name, app.args[i]]));
        const fields = new Set();
        for (const field of pattern.fields) {
          const definition = shape.fields.find(f => f.name === field.name);
          if (!definition || fields.has(field.name)) throw new Diagnostic('E0025', `Unknown or duplicate field ${field.name}`, pattern.span);
          fields.add(field.name);
          this.analyzer.index.fieldVisible(shape, definition, context.instance.fn.module, field.pattern);
          const fieldType = this.analyzer.index.type(T.substitute(definition.type, substitution), shape.module);
          this.analyze(field.pattern, fieldType, context, mutable, bindings, names, reuse);
        }
        if (!pattern.rest && fields.size !== shape.fields.length) throw new Diagnostic('E0027', `Pattern ${shape.name} must mention every field or use '..'`, pattern.span);
        pattern.name = shape.name;
        return;
      }
      case 'variantPattern': {
        const constructor = this.analyzer.index.constructorFor(pattern.name === 'Self' ? context.instance.fn.owner : pattern.name, context.instance.fn.module, pattern);
        const app = T.application(type);
        if (!constructor || constructor.owner.name !== app.name) throw new Diagnostic('E0532', `Pattern ${pattern.name} does not match ${type}`, pattern.span);
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
        this.expandRest(pattern, constructor.variant.fields.length, 'E0023');
        const substitution = new Map(constructor.owner.generics.map((g, i) => [g.name, app.args[i]]));
        pattern.variant = constructor.tag;
        pattern.items.forEach((p, i) => this.analyze(p, T.substitute(constructor.variant.fields[i], substitution), context, mutable, bindings, names, reuse));
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
    if (pattern.binding && !this.analyzer.hasTrait(pattern.binding.type, 'Copy')) return true;
    if (pattern.kind === 'atPattern') return this.hasNonCopyBinding(pattern.binder) || this.hasNonCopyBinding(pattern.pattern);
    if (pattern.items?.some(p => this.hasNonCopyBinding(p))) return true;
    if (pattern.fields?.some(f => this.hasNonCopyBinding(f.pattern))) return true;
    return pattern.restBinding ? this.hasNonCopyBinding(pattern.restBinding.binder) : false;
  }

}
