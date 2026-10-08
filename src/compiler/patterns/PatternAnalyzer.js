import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';

/** Types pattern projections and assigns consistent local slots to alternatives. */
export class PatternAnalyzer {
  constructor(analyzer) { this.analyzer = analyzer; }

  analyze(pattern, type, context, mutable = false, bindings = new Map(), names = new Set(), reuse = false) {
    pattern.type = type;
    switch (pattern.kind) {
      case 'wildcard': return;
      case 'bindingPattern': {
        const index = this.analyzer.index;
        const constant = index.resolve(index.constants, pattern.name, context.instance.fn.module, pattern, false);
        const constructor = index.constructorFor(pattern.name, context.instance.fn.module);
        if (constant || constructor) {
          if (pattern.mutable) throw new Diagnostic('E0530', 'A binding cannot shadow a constant or enum constructor', pattern.span);
          if (constructor) {
            pattern.kind = 'variantPattern'; pattern.items = [];
          } else {
            const literal = structuredClone(constant.value);
            this.analyzer.infer(literal, context, index.type(constant.type, constant.module));
            if (literal.kind !== 'literal') throw new Diagnostic('F_PATTERN_CONST', 'Computed constant patterns require native Cargo', pattern.span);
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
        for (const endpoint of [pattern.from, pattern.to]) {
          T.unify(type, this.analyzer.infer(endpoint, context, type), new Map(), endpoint);
          if (endpoint.kind !== 'literal') throw new Diagnostic('F_PATTERN_CONST', 'Range endpoints currently require literal constants', endpoint.span);
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
        if (parts.length !== pattern.items.length) throw new Diagnostic('E0527', 'Tuple pattern arity does not match', pattern.span);
        pattern.items.forEach((p, i) => this.analyze(p, parts[i], context, mutable, bindings, names, reuse));
        return;
      }
      case 'structPattern': {
        const shape = this.analyzer.index.resolve(this.analyzer.index.structs, pattern.name, context.instance.fn.module, pattern);
        const app = T.application(type);
        if (app.name !== shape.name) throw new Diagnostic('E0308', `Pattern ${shape.name} does not match ${type}`, pattern.span);
        const substitution = new Map(shape.generics.map((g, i) => [g.name, app.args[i]]));
        const fields = new Set();
        for (const field of pattern.fields) {
          const definition = shape.fields.find(f => f.name === field.name);
          if (!definition || fields.has(field.name)) throw new Diagnostic('E0025', `Unknown or duplicate field ${field.name}`, pattern.span);
          fields.add(field.name);
          const fieldType = this.analyzer.index.type(T.substitute(definition.type, substitution), shape.module);
          this.analyze(field.pattern, fieldType, context, mutable, bindings, names, reuse);
        }
        if (!pattern.rest && fields.size !== shape.fields.length) throw new Diagnostic('E0027', `Pattern ${shape.name} must mention every field or use '..'`, pattern.span);
        pattern.name = shape.name;
        return;
      }
      case 'variantPattern': {
        const constructor = this.analyzer.index.constructorFor(pattern.name, context.instance.fn.module);
        const app = T.application(type);
        if (!constructor || constructor.owner.name !== app.name) throw new Diagnostic('E0532', `Pattern ${pattern.name} does not match ${type}`, pattern.span);
        if (constructor.variant.fields.length !== pattern.items.length) throw new Diagnostic('E0023', 'Variant pattern arity mismatch', pattern.span);
        const substitution = new Map(constructor.owner.generics.map((g, i) => [g.name, app.args[i]]));
        pattern.variant = constructor.tag;
        pattern.items.forEach((p, i) => this.analyze(p, T.substitute(constructor.variant.fields[i], substitution), context, mutable, bindings, names, reuse));
        return;
      }
      default: throw new Diagnostic('F_PATTERN', `Pattern '${pattern.kind}' has no type rule`, pattern.span);
    }
  }
}
