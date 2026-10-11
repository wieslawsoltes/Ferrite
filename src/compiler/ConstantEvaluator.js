import {LiteralValue} from './LiteralValue.js';
import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {Lexer} from './Lexer.js';
import {Parser} from './Parser.js';
import {MirLowerer} from './MirLowerer.js';
import {MirOptimizer} from './MirOptimizer.js';
import {MirVerifier} from './MirVerifier.js';
import {OwnershipAnalyzer} from './OwnershipAnalyzer.js';
import {MirVirtualMachine} from '../runtime/MirVirtualMachine.js';

/**
 * Bounded, declaration-scoped constant evaluation on the production typed MIR.
 * No eval, user callbacks, alternative arithmetic engine, or execution of user IO.
 * A compiler-owned resolver links lazy enum constants only during const evaluation.
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
    this.running = new Set(); this.references = new Map();
    this.steps = 0; this.evaluations = 0; this.hits = 0; this.sequence = 0;
  }

  /** Check unused concrete initializers without executing their own values.
   * Rust still validates surviving concrete constant operands in their MIR.
   * Type-only dependency MIR exists exclusively in an isolated analyzer. */
  checkAssociatedDefinitions() {
    if (![...this.index.functions.values()].some(fn => fn.associatedConstant && fn.body && !fn.generics.length)) return;
    // Function items, closures, obligations and discriminants also own side tables;
    // isolating just instances would leave dangling callable identities behind.
    const a = new this.analyzer.constructor(this.analyzer.ast, {mode: 'library',
      maxInstances: this.analyzer.maxInstances, constEvaluation: this.analyzer.constEvaluationOptions});
    a.constants.checkingDefinition = true;
    for (const fn of a.index.functions.values()) if (fn.associatedConstant && fn.body && !fn.generics.length)
      a.instantiate(fn, [], [], fn);
    for (const instance of a.instances.values()) if (instance.fn.isConst) a.constants.validate(instance);
    const instances = [...a.instances.values()];
    OwnershipAnalyzer.analyze({instances});
    const verification = {allowDeferredDiscriminants: true, constantReferences: a.constants.references};
    const mir = MirLowerer.lower({instances}, verification);
    MirVerifier.verify(mir, verification);
    const {functions} = MirOptimizer.optimize(mir, verification);
    const roots = new Set(instances.filter(i => i.fn.associatedConstant && !i.fn.generics.length && !i.fn.defaultTrait).map(i => i.key));
    let evaluator = null;
    for (const fn of functions) if (roots.has(fn.instance)) for (const block of fn.blocks)
      for (const instruction of block.instructions) if (instruction.op === 'constantReference') {
        // Do not execute with the type-only analyzer's cached function bodies:
        // callees there intentionally contain unresolved reference operands.
        if (!evaluator) {
          const maxSteps = this.maxSteps - this.steps - a.constants.steps;
          const maxExpressions = this.maxExpressions - this.evaluations - a.constants.evaluations;
          if (maxSteps <= 0 || maxExpressions <= 0)
            throw new Diagnostic('F_CONST_BUDGET', 'Compilation-wide constant dependency budget exceeded', instruction.span);
          evaluator = new this.analyzer.constructor(this.analyzer.ast, {mode: 'library',
            maxInstances: this.analyzer.maxInstances,
            constEvaluation: {...this.analyzer.constEvaluationOptions, maxSteps, maxExpressions}});
        }
        const reference = a.constants.references.get(instruction.key);
        const declaration = evaluator.index.functions.get(reference.fn.name);
        evaluator.constants.evaluate(declaration.body.tail, declaration.module, declaration.returnType, declaration,
          instruction.key, instruction, declaration.owner, {declaration, explicit: reference.arguments});
      }
    // Definition dependencies share the compilation-wide budget, not a separate
    // allowance per initializer (the isolated analyzer otherwise owns all state).
    this.steps += a.constants.steps + (evaluator?.constants.steps ?? 0);
    this.evaluations += a.constants.evaluations + (evaluator?.constants.evaluations ?? 0);
    if (this.steps > this.maxSteps || this.evaluations > this.maxExpressions)
      throw new Diagnostic('F_CONST_BUDGET', 'Compilation-wide constant evaluation budget exceeded');
  }

  constant(declaration, use = declaration) {
    return this.evaluate(declaration.value, declaration.module, declaration.type, declaration, `item:${declaration.name}`, use);
  }

  expression(expression, module = '', expected = '_', use = expression, context = null) {
    const fn = context?.instance.fn, arguments_ = context?.instance.substitution ?? new Map(Object.entries(context?.instance.typeArguments ?? {}));
    return this.evaluate(expression, module, expected, use, null, use, fn?.owner, fn ?
      {declaration: fn, explicit: fn.generics.map(g => arguments_.get(g.name))} : null);
  }

  length(source, module = '', node = null, parameters = new Set(), owner = null) {
    if (parameters.has(source)) return source;
    if (/^\d+$/.test(source)) {
      const value = BigInt(source);
      if (value > 0xffffffffn) throw new Diagnostic('E0080', 'Array length overflows the browser target usize (32 bits)', node?.span);
      return String(value);
    }
    const declaration = node?.typeContext ?? node;
    const scope = {generics: [], predicates: [], defaultTrait: declaration?.defaultTrait, implementedTrait: declaration?.implementedTrait};
    const key = 'length:' + JSON.stringify([module, owner, scope.defaultTrait, scope.implementedTrait, source]);
    if (this.cache.has(key)) { this.hits++; return this.cache.get(key).expression.value; }
    const parser = new Parser(Lexer.tokenize(source, {file: node?.span?.file ?? '<array-length>'}));
    const expression = parser.expr(); parser.c.eat('EOF');
    // Type names are canonical strings. Reparsed length syntax is attributed to
    // the original declaration, never to invented offsets in a generated file.
    if (node?.span) this.reanchor(expression, node.span);
    return this.evaluate(expression, module, 'usize', node ?? expression, key, node ?? expression, owner, {declaration: scope, explicit: []}).expression.value;
  }

  reanchor(node, span) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(value => this.reanchor(value, span)); return; }
    if (node.kind) node.span = {...span};
    for (const [key, value] of Object.entries(node)) if (!['span', 'loc'].includes(key)) this.reanchor(value, span);
  }

  evaluate(expression, module, expected, origin, key = null, use = origin, owner = null, specialization = null) {
    if (key && this.cache.has(key)) { this.hits++; return this.cache.get(key); }
    if (key && this.active.has(key)) throw new Diagnostic('E0391', 'Cycle in constant evaluation', use?.span, [{message: [...this.active, key].join(' → '), span: origin?.span}]);
    if (++this.evaluations > this.maxExpressions || this.active.size >= 128) throw new Diagnostic('F_CONST_BUDGET', 'Constant evaluation expression/dependency budget exceeded', origin?.span);
    const name = `$const$${this.sequence++}`; let rootKey = null;
    const fn = {...specialization?.declaration, kind: 'fn', name, localName: name, module, isConst: true, constRoot: true, owner,
      generics: specialization?.declaration.generics ?? [], predicates: specialization?.declaration.predicates ?? [],
      params: [], returnType: expected, attributes: [], visibility: 'private',
      span: origin?.span ?? expression.span, id: `${expression.id}:const-root`,
      body: {kind: 'block', id: `${expression.id}:const-body`, span: expression.span, body: [], tail: structuredClone(expression)}};
    const queryCache = this.analyzer.queryCache, checkingDefinition = this.checkingDefinition;
    this.checkingDefinition = false;
    if (key) this.active.add(key);
    this.analyzer.queryCache = null;
    try {
      const instance = this.analyzer.instantiate(fn, [], specialization?.explicit ?? [], use ?? origin ?? expression);
      rootKey = instance.key;
      const reachable = this.reachable(instance);
      for (const current of reachable) this.validate(current);
      OwnershipAnalyzer.analyze({instances: reachable});
      // Taking a function's address does not execute its body. Include referenced
      // implementations for MIR signature verification without imposing const-call
      // restrictions on those unreachable-at-evaluation targets.
      const all=new Map(reachable.map(i=>[i.key,i]));
      const include=key=>{
        if(all.has(key))return;const value=this.analyzer.instances.get(key);
        if(!value||value.substitution)throw new Diagnostic('E0391','Function address depends on incomplete type checking',origin?.span);
        all.set(key,value);value.calls.forEach(call=>include(call.to));addresses(value.fn.body);
      };
      const addresses=node=>{if(!node||typeof node!=='object')return;
        if(node.pointerTarget)include(node.pointerTarget);
        for(const [key,value] of Object.entries(node))if(!['span','loc','binding'].includes(key))addresses(value);
      };
      reachable.forEach(i=>addresses(i.fn.body));
      const functions = MirLowerer.lower({instances: [...all.values()]});
      // Address-only targets are verified but not executed during CTFE.
      // Requiring their local layouts would invent enum dependency cycles.
      const executed = new Set(reachable.map(item => item.key));
      this.analyzer.discriminants.requireLayouts(functions.filter(fn => executed.has(fn.instance)));
      MirVerifier.verify(functions, {allowDeferredDiscriminants: true});
      const remaining = Math.min(this.maxExpressionSteps, this.remainingSteps());
      if (remaining <= 0) throw new Diagnostic('F_CONST_BUDGET', 'Compilation-wide constant evaluation instruction budget exceeded', origin?.span);
      const machine = new MirVirtualMachine(functions, {entry: instance.key, maxSteps: remaining, maxDepth: 128, maxTrace: 0, maxOutput: 0, overflow: 'checked',
        resolveDiscriminant: (name, tag) => {
          const result = this.analyzer.discriminants.resolveTag(name, tag);
          const available = this.remainingSteps();
          for (const runtime of this.running) runtime.maxSteps = Math.min(runtime.maxSteps, runtime.steps + available);
          return result;
        }});
      this.running.add(machine.runtime);
      try {
        while (!machine.done) machine.step({capture: false});
      } catch (error) {
        if (error instanceof Diagnostic) throw error;
        throw new Diagnostic(error.code === 'R_BUDGET' || error.code === 'R_STACK' ? 'F_CONST_BUDGET' : 'E0080',
          `Constant evaluation failed: ${error.message}`, error.span ?? origin?.span,
          [{message: 'Required by this constant context', span: origin?.span}]);
      } finally { this.running.delete(machine.runtime); this.steps += machine.runtime.steps; }
      const result = {type: instance.returnType, expression: this.materialize(machine.result, instance.returnType, origin ?? expression)};
      if (key) this.cache.set(key, result);
      if (this.reports.length < 512) this.reports.push({name: key ?? 'const expression', type: result.type, steps: machine.runtime.steps,
        value: this.preview(machine.result, machine.runtime), span: origin?.span ?? expression.span});
      return result;
    } finally {
      this.analyzer.queryCache = queryCache; this.checkingDefinition = checkingDefinition;
      if (rootKey) this.analyzer.instances.delete(rootKey);
      if (key) this.active.delete(key);
    }
  }

  remainingSteps() {
    let used = this.steps;
    for (const runtime of this.running) used += runtime.steps;
    return Math.max(0, this.maxSteps - used);
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
      if(node.kind==='functionCoercion'&&node.value.kind==='closure'&&!node.value.fields.length)return;
      if (node.kind === 'for' || node.kind === 'closure') throw new Diagnostic('E0015', `${node.kind} is not supported in browser const contexts`, node.span);
      if (node.kind === 'binary' && !T.numeric(node.operandType) && !['bool', 'char'].includes(node.operandType)) {
        throw new Diagnostic('E0015', 'This operator would require a non-const trait implementation', node.span);
      }
      if(node.indirect)throw new Diagnostic('E0015','Function-item trait calls are not allowed in a constant context',node.span);
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
    if (T.numeric(type) || ['bool', 'char', '&str', '()'].includes(type)) return {...node, value: LiteralValue.encode(value)};
    if(T.function(type))return {...node,kind:'functionPointer',pointerTarget:value.target,pointerSignature:type};
    const child = (v, t, key) => this.materialize(v, t, origin, `${path}.${key}`, budget);
    const array = T.array(type);
    if (array) {
      if (value.length > this.maxValues) throw new Diagnostic('F_CONST_BUDGET', 'Constant array exceeds the materialization budget', origin?.span);
      if (value.length > 1 && value.every(v => Object.is(v, value[0])) && (T.numeric(array.element) || ['bool', 'char', '&str'].includes(array.element))) {
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
    const prefix = shape.name + '::';
    const variant = typeof value.tag === 'string' && value.tag.startsWith(prefix)
      ? this.index.variant(shape, value.tag.slice(prefix.length)) : null;
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
