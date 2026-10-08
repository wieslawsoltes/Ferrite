import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {Lexer} from './Lexer.js';
import {Parser} from './Parser.js';
import {MirLowerer} from './MirLowerer.js';
import {MirVerifier} from './MirVerifier.js';
import {OwnershipAnalyzer} from './OwnershipAnalyzer.js';
import {MirVirtualMachine} from '../runtime/MirVirtualMachine.js';

/**
 * Bounded, declaration-scoped constant evaluation on the production typed MIR.
 * No eval, host callbacks, alternative arithmetic engine, or execution of user IO.
 * Temporary evaluation roots never escape into runtime code or incremental caches.
 */
export class ConstantEvaluator {
  constructor(analyzer, {maxSteps = 1000000, maxExpressionSteps = 250000, maxExpressions = 4096, maxValues = 100000} = {}) {
    for (const value of [maxSteps, maxExpressionSteps, maxExpressions, maxValues]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Diagnostic('F_CONST_CONFIG', 'Constant evaluation limits must be positive safe integers');
    }
    this.analyzer = analyzer; this.index = analyzer.index;
    this.maxSteps = maxSteps; this.maxExpressionSteps = maxExpressionSteps; this.maxExpressions = maxExpressions; this.maxValues = maxValues;
    this.cache = new Map(); this.active = new Set(); this.reports = [];
    this.steps = 0; this.evaluations = 0; this.hits = 0; this.sequence = 0;
  }

  constant(declaration, use = declaration) {
    return this.evaluate(declaration.value, declaration.module, declaration.type, declaration, `item:${declaration.name}`, use);
  }

  expression(expression, module = '', expected = '_', use = expression) {
    return this.evaluate(expression, module, expected, use, null, use);
  }

  length(source, module = '', node = null, parameters = new Set()) {
    if (parameters.has(source)) return source;
    if (/^\d+$/.test(source)) {
      const value = BigInt(source);
      if (value > 0xffffffffn) throw new Diagnostic('E0080', 'Array length overflows the browser target usize (32 bits)', node?.span);
      return String(value);
    }
    const key = `length:${module}:${source}`;
    if (this.cache.has(key)) { this.hits++; return this.cache.get(key).expression.value; }
    const parser = new Parser(Lexer.tokenize(source, {file: node?.span?.file ?? '<array-length>'}));
    const expression = parser.expr(); parser.c.eat('EOF');
    // Type names are canonical strings. Reparsed length syntax is attributed to
    // the original declaration, never to invented offsets in a generated file.
    if (node?.span) this.reanchor(expression, node.span);
    return this.evaluate(expression, module, 'usize', node ?? expression, key).expression.value;
  }

  reanchor(node, span) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(value => this.reanchor(value, span)); return; }
    if (node.kind) node.span = {...span};
    for (const [key, value] of Object.entries(node)) if (!['span', 'loc'].includes(key)) this.reanchor(value, span);
  }

  evaluate(expression, module, expected, origin, key = null, use = origin) {
    if (key && this.cache.has(key)) { this.hits++; return this.cache.get(key); }
    if (key && this.active.has(key)) throw new Diagnostic('E0391', 'Cycle in constant evaluation', use?.span, [{message: [...this.active, key].join(' → '), span: origin?.span}]);
    if (++this.evaluations > this.maxExpressions || this.active.size >= 128) throw new Diagnostic('F_CONST_BUDGET', 'Constant evaluation expression/dependency budget exceeded', origin?.span);
    const name = `$const$${this.sequence++}`, rootKey = `${name}<>`;
    const fn = {kind: 'fn', name, localName: name, module, isConst: true, constRoot: true,
      generics: [], predicates: [], params: [], returnType: expected, attributes: [], visibility: 'private',
      span: origin?.span ?? expression.span, id: `${expression.id}:const-root`,
      body: {kind: 'block', id: `${expression.id}:const-body`, span: expression.span, body: [], tail: structuredClone(expression)}};
    const queryCache = this.analyzer.queryCache;
    if (key) this.active.add(key);
    this.analyzer.queryCache = null;
    try {
      const instance = this.analyzer.instantiate(fn, [], [], origin ?? expression);
      const reachable = this.reachable(instance);
      for (const current of reachable) this.validate(current);
      OwnershipAnalyzer.analyze({instances: reachable});
      const functions = MirLowerer.lower({instances: reachable});
      MirVerifier.verify(functions);
      const remaining = Math.min(this.maxExpressionSteps, this.maxSteps - this.steps);
      if (remaining <= 0) throw new Diagnostic('F_CONST_BUDGET', 'Compilation-wide constant evaluation instruction budget exceeded', origin?.span);
      const machine = new MirVirtualMachine(functions, {entry: instance.key, maxSteps: remaining, maxDepth: 128, maxTrace: 0, maxOutput: 0, overflow: 'checked'});
      try {
        while (!machine.done) machine.step({capture: false});
      } catch (error) {
        throw new Diagnostic(error.code === 'R_BUDGET' || error.code === 'R_STACK' ? 'F_CONST_BUDGET' : 'E0080',
          `Constant evaluation failed: ${error.message}`, error.span ?? origin?.span,
          [{message: 'Required by this constant context', span: origin?.span}]);
      } finally { this.steps += machine.runtime.steps; }
      const result = {type: instance.returnType, expression: this.materialize(machine.result, instance.returnType, origin ?? expression)};
      if (key) this.cache.set(key, result);
      if (this.reports.length < 512) this.reports.push({name: key ?? 'const expression', type: result.type, steps: machine.runtime.steps,
        value: this.preview(machine.result, machine.runtime), span: origin?.span ?? expression.span});
      return result;
    } finally {
      this.analyzer.queryCache = queryCache;
      this.analyzer.instances.delete(rootKey);
      if (key) this.active.delete(key);
    }
  }

  reachable(root) {
    const result = [], seen = new Set(), visit = instance => {
      if (seen.has(instance.key)) return; seen.add(instance.key);
      if (instance.substitution) throw new Diagnostic('E0391', `Constant evaluation depends on incomplete type checking of ${instance.name}`, instance.fn.span);
      if (!instance.fn.isConst) throw new Diagnostic('E0015', `Cannot call non-const function '${instance.name}' in a constant context`, root.fn.span);
      result.push(instance);
      for (const call of instance.calls) {
        const target = this.analyzer.instances.get(call.to);
        if (!target) throw new Diagnostic('F_CONST_MIR', 'Missing constant call target', call.span);
        visit(target);
      }
    };
    visit(root); return result;
  }

  validate(instance) {
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.kind === 'for' || node.kind === 'closure') throw new Diagnostic('E0015', `${node.kind} is not supported in browser const contexts`, node.span);
      if (node.kind === 'binary' && !T.numeric(node.operandType) && !['bool', 'char'].includes(node.operandType)) {
        throw new Diagnostic('E0015', 'This operator would require a non-const trait implementation', node.span);
      }
      if (node.kind === 'call' || node.kind === 'intrinsic') {
        if (node.resolved) {
          const fn = this.analyzer.instances.get(node.resolved)?.fn;
          if (!fn?.isConst) throw new Diagnostic('E0015', `Cannot call non-const function '${fn?.name ?? node.resolved}' in a constant context`, node.span);
        } else if (!node.variant) {
          const builtin = node.builtin ?? node.name;
          if (!['assert', 'panic', 'method::len', 'method::is_some', 'method::is_none', 'method::is_ok', 'method::is_err'].includes(builtin)) {
            throw new Diagnostic('E0015', `Call '${builtin}' is not supported in browser const contexts`, node.span);
          }
          if (builtin === 'panic' && ((node.args?.length ?? 0) > 1 || node.args?.[0] && node.args[0].kind !== 'literal')) {
            throw new Diagnostic('E0015', 'Const panic requires a literal message without formatting arguments', node.span);
          }
        }
      }
      for (const [key, value] of Object.entries(node)) if (!['span', 'loc', 'binding'].includes(key)) visit(value);
    };
    visit(instance.fn.body);
  }

  materialize(value, type, origin, path = 'value', budget = {count: 0}) {
    if (++budget.count > this.maxValues) throw new Diagnostic('F_CONST_BUDGET', 'Constant value exceeds the materialization budget', origin?.span);
    const node = {kind: 'literal', id: `${origin?.id}:const:${path}`, span: origin?.span, type, copy: this.analyzer.hasTrait(type, 'Copy')};
    if (T.numeric(type) || ['bool', 'char', '&str', '()'].includes(type)) return {...node, value: typeof value === 'bigint' ? String(value) : value};
    const child = (v, t, key) => this.materialize(v, t, origin, `${path}.${key}`, budget);
    const array = T.array(type);
    if (array) {
      if (value.length > this.maxValues) throw new Diagnostic('F_CONST_BUDGET', 'Constant array exceeds the materialization budget', origin?.span);
      if (value.length > 1 && value.every(v => v === value[0]) && (T.numeric(array.element) || ['bool', 'char', '&str'].includes(array.element))) {
        return {...node, kind: 'repeatArray', length: value.length, value: child(value[0], array.element, 0)};
      }
      return {...node, kind: 'array', items: value.map((v, i) => child(v, array.element, i))};
    }
    const tuple = T.tuple(type);
    if (tuple) return {...node, kind: 'tuple', items: value.map((v, i) => child(v, tuple[i], i))};
    if (T.reference(type)) throw new Diagnostic('F_CONST_ALLOCATION', 'Constant reference allocation/promotion is not yet supported by the browser backend', origin?.span);
    const app = T.application(type), structure = this.index.structs.get(app.name), enumeration = this.index.enums.get(app.name);
    const shape = structure ?? enumeration;
    if (!shape) throw new Diagnostic('F_CONST_VALUE', `Cannot materialize constant type ${type}`, origin?.span);
    const substitution = new Map(shape.generics.map((g, i) => [g.name, app.args[i]]));
    const fieldType = t => this.index.type(T.substitute(t, substitution), shape.module);
    if (structure) return {...node, kind: 'structLiteral', name: shape.name,
      fields: shape.fields.map(field => ({name: field.name, value: child(value[field.name], fieldType(field.type), field.name)}))};
    const variant = shape.variants.find(v => `${shape.name}::${v.name}` === value.tag);
    if (!variant) throw new Diagnostic('F_CONST_VALUE', 'Invalid evaluated enum discriminant', origin?.span);
    return {...node, kind: 'call', variant: value.tag, args: variant.fields.map((t, i) => child(value.values[i], fieldType(t), i))};
  }

  preview(value, runtime) {
    let remaining = 128;
    const truncate = (value, depth = 0) => {
      if (--remaining < 0 || depth > 8) return '…';
      if (typeof value === 'string') return value.slice(0, 256);
      if (Array.isArray(value)) return value.slice(0, 16).map(v => truncate(v, depth + 1)).concat(value.length > 16 ? ['…'] : []);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 16).map(([key, v]) => [key, truncate(v, depth + 1)]));
      return value;
    };
    return runtime.debug(truncate(value)).slice(0, 2048);
  }

  snapshot() { return {evaluations: this.evaluations, hits: this.hits, steps: this.steps, entries: this.cache.size, values: this.reports}; }
}
