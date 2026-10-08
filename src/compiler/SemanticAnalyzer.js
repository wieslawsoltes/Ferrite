import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {SymbolIndex} from './SymbolIndex.js';
import {FunctionContext} from './FunctionContext.js';
import {FormatParser} from './FormatParser.js';
import {SemanticQueryCache} from './SemanticQueryCache.js';
import {ClosureAnalyzer} from './closures/ClosureAnalyzer.js';

/** Monomorphized typed HIR. Every local has an identity independent of its spelling. */
export class SemanticAnalyzer {
  constructor(ast, {entry = 'main', mode = 'run', maxInstances = 2048, queryCache = null} = {}) {
    this.index = new SymbolIndex(ast);
    // Synthesized closure declarations belong to this analysis session. Never replay
    // cached callers without their anonymous declaration/capture environment.
    if(JSON.stringify(ast).includes('"kind":"closure"'))queryCache=null;
    this.closures=new ClosureAnalyzer(this);
    this.queryCache = queryCache; this.environment = queryCache ? SemanticQueryCache.environment(this.index) : null;
    this.instances = new Map(); this.obligations = []; this.warnings = [];
    this.entry = entry; this.mode = mode; this.maxInstances = maxInstances; this.depth = 0;
    this.constantStack = new Set();
  }
  static analyze(ast, options) { return new SemanticAnalyzer(ast, options).analyze(); }
  analyze() {
    if (this.mode !== 'library') {
      const main = this.index.resolve(this.index.functions, this.entry, '', null);
      if (main.params.length) throw new Diagnostic('E0580', 'Entry point must not take parameters', main.span);
      this.entryKey = this.instantiate(main, [], [], main).key;
    }
    // Rust checks unreachable declarations too, not just the application call graph.
    for (const fn of this.index.functions.values()) if (fn.body && !fn.generics.length) {
      const types = fn.params.map(p => this.index.type(p.type, fn.module, fn.owner));
      this.instantiate(fn, types, [], fn);
    }
    this.closures.finish();
    return {closures:this.closures.snapshot(), instances: [...this.instances.values()], obligations: this.obligations,
      symbols: this.index.symbols, structures: [...this.index.structs.values()],
      enums: [...this.index.enums.values()], warnings: this.warnings, entry: this.entryKey,
      capabilities: {ownership: 'conservative whole-local analysis', traits: 'concrete impls and built-in bounds'}};
  }
  annotate(node, type) { node.type = type; return type; }
  normalize(type, ctx) { return this.index.type(T.substitute(type, ctx.instance.substitution), ctx.instance.fn.module, ctx.instance.fn.owner); }
  hasTrait(type, bound, depth = 0) {
    if (depth > 32) return false;
    const closure=this.closures.get(type);
    if(ClosureAnalyzer.bound(bound))return this.closures.satisfies(type,bound);
    if(closure&&['Copy','Clone'].includes(bound))return this.closures.copy(closure);
    bound = bound.split('::').at(-1);
    if (bound === 'Display') return T.numeric(type) || ['bool', 'char', '&str', 'String'].includes(type);
    if (bound === 'Copy' && T.primitiveCopy(type)) return true;
    if (['Clone', 'Debug', 'PartialEq', 'Eq'].includes(bound) && (T.primitiveCopy(type) || type === 'String')) return bound !== 'Eq' || !type.startsWith('f');
    const array = /^\[(.+);\d+\]$/.exec(type);
    if (array) return this.hasTrait(array[1], bound, depth + 1);
    if (type.startsWith('(')) return T.split(type.slice(1, -1)).every(t => this.hasTrait(t, bound, depth + 1));
    const {name, args} = T.application(type);
    if (name === 'Vec') return bound !== 'Copy' && ['Clone', 'Debug', 'PartialEq', 'Eq'].includes(bound) && this.hasTrait(args[0], bound, depth + 1);
    if (['Option', 'Result'].includes(name)) return ['Copy', 'Clone', 'Debug', 'PartialEq', 'Eq'].includes(bound) && args.every(t => t !== '_' && this.hasTrait(t, bound, depth + 1));
    const shape = this.index.structs.get(name) ?? this.index.enums.get(name);
    if (shape?.attributes?.some(a => a.name === 'derive' && a.args.includes(bound))) {
      const substitution = new Map(shape.generics.map((g, i) => [g.name, args[i]]));
      const fields = shape.fields?.map(f => f.type) ?? shape.variants.flatMap(v => v.fields);
      return fields.every(t => this.hasTrait(T.substitute(t, substitution), bound, depth + 1));
    }
    return this.index.impls.some(impl => this.index.type(impl.target, impl.module) === type && impl.trait?.split('::').at(-1) === bound);
  }
  instantiate(fn, argumentTypes, explicit = [], node = fn) {
    if (fn.params.length !== argumentTypes.length) throw new Diagnostic('E0061', `${fn.name} expects ${fn.params.length} argument(s), got ${argumentTypes.length}`, node.span);
    const substitution = new Map(fn.generics.map((g, i) => [g.name, explicit[i] ?? null]));
    if (explicit.length > fn.generics.length) throw new Diagnostic('E0107', 'Too many generic arguments', node.span);
    fn.params.forEach((p, i) => T.unify(this.index.type(p.type, fn.module, fn.owner), argumentTypes[i], substitution, node));
    for (const parameter of fn.generics) {
      const type = substitution.get(parameter.name);
      if (!type || /\b_\b/.test(type)) throw new Diagnostic('E0282', `Cannot infer ${parameter.name} in ${fn.name}`, node.span);
      for (const rawBound of parameter.bounds) {
        const bound=this.index.type(T.substitute(rawBound,substitution),fn.module,fn.owner);
        if (!this.hasTrait(type, bound)) throw new Diagnostic('E0277', `Trait obligation failed: ${type}: ${bound}`, node.span);
        this.obligations.push({type, trait: bound, status: 'satisfied', span: node.span});
      }
    }
    const key = fn.name + '<' + fn.generics.map(g => substitution.get(g.name)).join(',') + '>';
    const existing = this.instances.get(key);
    if (existing) return existing;
    if (++this.depth > 128 || this.instances.size >= this.maxInstances) throw new Diagnostic('F0201', 'Generic instantiation budget exceeded', node.span);
    if (!fn.body) throw new Diagnostic('E0046', `Function ${fn.name} has no implementation`, fn.span);
    const query = this.queryCache?.lookup('type', JSON.stringify([this.environment, fn, argumentTypes, explicit]), {id: key, span: fn.span});
    if (query?.value) {
      const instance = structuredClone(query.value.instance); this.instances.set(key, instance);
      query.node.dependencies = query.value.dependencies.map(d => `type:${d.key}`);
      for (const dependency of query.value.dependencies) {
        const current = this.index.functions.get(dependency.name);
        if (!current) throw new Diagnostic('F_QUERY', 'A cached callee disappeared from the declaration environment', fn.span);
        this.instantiate(current, dependency.argumentTypes, dependency.explicit, {span: dependency.span});
      }
      this.warnings.push(...structuredClone(query.value.warnings)); this.depth--; return instance;
    }
    const warningStart = this.warnings.length;
    const copy = structuredClone(fn);
    const instance = {key, name: fn.name, fn: copy, substitution, typeArguments: Object.fromEntries(substitution),
      returnType: this.index.type(T.substitute(fn.returnType, substitution), fn.module, fn.owner), calls: [], locals: []};
    this.instances.set(key, instance);
    const ctx = new FunctionContext(instance);
    copy.params.forEach((p, i) => { p.type = argumentTypes[i]; p.binding = ctx.declare(p.name, p.type, p.mutable, p, true); });
    ctx.inferredReturns=[];
    const abstractReturn=instance.returnType.startsWith('impl ')?instance.returnType.slice(5):null;
    const actual = this.block(copy.body, ctx, instance.returnType==='_'||abstractReturn?null:instance.returnType);
    if(instance.returnType==='_'||abstractReturn){
      const inferred=ctx.inferredReturns.reduce((type,next)=>T.join(type,next,copy.body),actual);
      if(abstractReturn&&!this.hasTrait(inferred,abstractReturn))throw new Diagnostic('E0277',`Returned type does not implement ${abstractReturn}`,copy.body.span);
      instance.returnType=inferred;
    }else T.unify(instance.returnType, actual, new Map(), copy.body);
    instance.locals = ctx.locals;
    delete instance.substitution;
    if (query) {
      const dependencies = instance.calls.map(call => {
        const target = this.instances.get(call.to);
        return {key: target.key, name: target.name, argumentTypes: target.fn.params.map(p => p.type),
          explicit: target.fn.generics.map(g => target.typeArguments[g.name]), span: call.span};
      });
      query.node.dependencies = dependencies.map(d => `type:${d.key}`);
      const warnings = this.warnings.slice(warningStart).filter(w => w.span?.file === fn.span?.file && w.span.start >= fn.span.start && w.span.end <= fn.span.end);
      this.queryCache.store(query, {instance, dependencies, warnings});
    }
    this.depth--;
    return instance;
  }
  infer(node, ctx, expected = null) {
    if (!node) return '()';
    let type;
    switch (node.kind) {
      case 'closure': type=this.closures.create(node,ctx);break;
      case 'literal': {
        type = node.type;
        if (type === '{integer}') type = expected && T.numeric(expected) ? expected : 'i32';
        if (T.integer(type)) {
          const value = BigInt(node.value);
          const bits = type.endsWith('size') ? 32 : Number(type.slice(1));
          const signed = type[0] === 'i', minimum = signed ? -(1n << BigInt(bits - 1)) : 0n;
          const maximum = (1n << BigInt(bits - (signed ? 1 : 0))) - 1n;
          if (value < minimum || value > maximum) throw new Diagnostic('E_LITERAL', `Literal ${node.value} is outside ${type}`, node.span);
        }
        break;
      }
      case 'variable': {
        const binding = ctx.lookup(node.name, node, false);
        if (binding) { node.binding = binding; type = binding.type; break; }
        const constant = this.index.resolve(this.index.constants, node.name, ctx.instance.fn.module, node, false);
        if (constant) {
          if (this.constantStack.has(constant.name)) throw new Diagnostic('E0391', 'Cyclic constant definition', node.span);
          this.constantStack.add(constant.name);
          node.constant = structuredClone(constant.value);
          type = this.infer(node.constant, ctx, constant.type); T.unify(constant.type, type, new Map(), node);
          this.constantStack.delete(constant.name); break;
        }
        const constructor = this.index.constructorFor(node.name, ctx.instance.fn.module);
        if (constructor && !constructor.variant.fields.length) { type = this.construct(node, constructor, [], ctx, expected); break; }
        throw new Diagnostic('E0425', `Unresolved identifier '${node.name}'`, node.span);
      }
      case 'tuple': type = '(' + node.items.map(n => this.infer(n, ctx)).join(',') + ')'; break;
      case 'array': {
        const hint = /^\[(.+);\d+\]$/.exec(expected ?? '')?.[1];
        const itemType = node.items.length ? this.infer(node.items[0], ctx, hint) : hint;
        if (!itemType) throw new Diagnostic('E0282', 'Empty array needs a type annotation', node.span);
        node.items.slice(1).forEach(n => T.unify(itemType, this.infer(n, ctx, itemType), new Map(), n));
        type = `[${itemType};${node.items.length}]`; break;
      }
      case 'repeatArray': {
        this.infer(node.count, ctx, 'usize');
        if (node.count.kind !== 'literal') throw new Diagnostic('F0202', 'Array repeat length must be a constant literal', node.span);
        const count = Number(node.count.value);
        if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw new Diagnostic('F0202', 'Array length exceeds the budget', node.span);
        const element = this.infer(node.value, ctx, /^\[(.+);\d+\]$/.exec(expected ?? '')?.[1]);
        if (count > 1 && !this.hasTrait(element, 'Copy')) throw new Diagnostic('E0277', 'Repeated array element must implement Copy', node.span);
        node.length = count; type = `[${element};${count}]`; break;
      }
      case 'structLiteral': {
        const shape = this.index.resolve(this.index.structs, node.name, ctx.instance.fn.module, node);
        const substitution = new Map(shape.generics.map(g => [g.name, null]));
        if (expected) {
          const application = T.application(expected);
          if (application.name === shape.name) shape.generics.forEach((g, i) => substitution.set(g.name, application.args[i]));
        }
        if (node.fields.length !== shape.fields.length) throw new Diagnostic('E0063', `Incorrect number of fields for ${shape.name}`, node.span);
        const seen = new Set();
        for (const field of node.fields) {
          const definition = shape.fields.find(f => f.name === field.name);
          if (!definition || seen.has(field.name)) throw new Diagnostic('E0062', `Unknown or duplicate field ${field.name}`, node.span);
          seen.add(field.name);
          const formal = this.index.type(T.substitute(definition.type, substitution), shape.module);
          const actual = this.infer(field.value, ctx, substitution.has(formal) ? null : formal);
          try { T.unify(formal, actual, substitution, field.value); }
          catch { throw new Diagnostic('E0308', `Field ${shape.name}.${field.name} expects ${formal}, got ${actual}`, field.value.span); }
        }
        type = shape.name + (shape.generics.length ? '<' + shape.generics.map(g => substitution.get(g.name)).join(',') + '>' : '');
        node.name = shape.name; break;
      }
      case 'field': {
        const object = this.infer(node.object, ctx), base = T.reference(object) && object !== '&str' ? T.target(object) : object;
        node.autoDeref = base !== object;
        if (base.startsWith('(')) {
          type = T.split(base.slice(1, -1))[Number(node.field)];
          if (!type || !/^\d+$/.test(node.field)) throw new Diagnostic('E0609', `Unknown tuple field ${node.field}`, node.span);
        } else {
          const application = T.application(base), shape = this.index.structs.get(application.name);
          const field = shape?.fields.find(f => f.name === node.field);
          if (!field) throw new Diagnostic('E0609', `Unknown field ${base}.${node.field}`, node.span);
          type = this.index.type(T.substitute(field.type, new Map(shape.generics.map((g, i) => [g.name, application.args[i]]))), shape.module);
        }
        break;
      }
      case 'index': {
        const object = this.infer(node.object, ctx), base = T.reference(object) ? T.target(object) : object;
        node.autoDeref = base !== object;
        const index = this.infer(node.index, ctx, 'usize');
        if (!T.integer(index)) throw new Diagnostic('E0277', 'Array index must be integer', node.index.span);
        const array = /^\[(.+);\d+\]$/.exec(base);
        const vector = T.application(base);
        type = array?.[1] ?? (vector.name === 'Vec' ? vector.args[0] : null);
        if (!type) throw new Diagnostic('E0608', `Cannot index ${base}`, node.span);
        break;
      }
      case 'unary': {
        // Negate literal magnitudes before range checking, including i32::MIN.
        if (node.op === '-' && node.value.kind === 'literal' && typeof node.value.value === 'string') {
          const literal = {...node.value, value: '-' + node.value.value};
          type = this.infer(literal, ctx, expected);
          node.kind = 'literal'; node.value = literal.value; node.type = type;
          return type;
        }
        const operand = this.infer(node.value, ctx, expected);
        if (node.op === '&') { this.place(node.value, ctx, node.mutable); type = '&' + (node.mutable ? 'mut ' : '') + operand; }
        else if (node.op === '*') {
          if (!T.reference(operand) || operand === '&str') throw new Diagnostic('E0614', `Cannot dereference ${operand}`, node.span);
          type = T.target(operand);
        } else if (node.op === '!') {
          if (operand !== 'bool' && !T.integer(operand)) throw new Diagnostic('E0600', `Cannot apply ! to ${operand}`, node.span);
          type = operand;
        } else { if (!T.numeric(operand)) throw new Diagnostic('E0600', 'Negation requires a number', node.span); type = operand; }
        break;
      }
      case 'binary': {
        const logical = ['&&', '||'].includes(node.op);
        const left = this.infer(node.left, ctx, logical ? 'bool' : expected && T.numeric(expected) ? expected : null);
        const right = this.infer(node.right, ctx, left);
        T.unify(left, right, new Map(), node);
        if (logical) { T.unify('bool', left, new Map(), node); type = 'bool'; }
        else if (['==', '!=', '<', '>', '<=', '>='].includes(node.op)) {
          if (!T.numeric(left) && !['bool', 'char', '&str', 'String'].includes(left))
            throw new Diagnostic('F_COMPARE', `Comparison on ${left} is not implemented`, node.span);
          type = 'bool';
        } else {
          if (!T.numeric(left)) throw new Diagnostic('E0369', `Arithmetic requires numeric operands, got ${left}`, node.span);
          type = left;
        }
        if (['&', '|', '^'].includes(node.op) && !T.integer(left))
          throw new Diagnostic('E0369', 'Bitwise operators require integer operands', node.span);
        node.operandType = left; break;
      }
      case 'cast': {
        const source = this.infer(node.value, ctx);
        if (!T.numeric(source) || !T.numeric(node.target)) throw new Diagnostic('E0605', 'Only numeric casts are supported', node.span);
        type = node.target; break;
      }
      case 'block': return this.block(node, ctx, expected);
      case 'ifLet': {
        const scrutinee = this.infer(node.value, ctx);
        ctx.push(); this.pattern(node.pattern, scrutinee, ctx);
        const yes = this.block(node.then, ctx, expected); ctx.pop();
        const no = node.otherwise ? this.infer(node.otherwise, ctx, expected) : '()';
        type = T.join(yes, no, node); break;
      }
      case 'ifExpr': {
        T.unify('bool', this.infer(node.condition, ctx, 'bool'), new Map(), node.condition);
        const yes = this.block(node.then, ctx, expected);
        const no = node.otherwise ? this.infer(node.otherwise, ctx, expected) : '()';
        type = T.join(yes, no, node); break;
      }
      case 'loopExpr': {
        const loop = {kind: 'loop', type: '!', breaks: []}; ctx.loops.push(loop);
        this.block(node.then, ctx, '()'); ctx.loops.pop(); type = loop.type; break;
      }
      case 'match': {
        const scrutinee = this.infer(node.value, ctx); let result = '!';
        const coverage = new Set(); let wildcard = false;
        for (const arm of node.arms) {
          ctx.push();
          const patternCoverage = this.pattern(arm.pattern, scrutinee, ctx, false);
          if (wildcard) this.warnings.push({severity: 'warning', code: 'W_UNREACHABLE', message: 'Unreachable match arm', span: arm.span});
          if (arm.guard) T.unify('bool', this.infer(arm.guard, ctx, 'bool'), new Map(), arm.guard);
          else { if (patternCoverage === '*') wildcard = true; else coverage.add(patternCoverage); }
          const value = this.infer(arm.body, ctx, expected);
          try { result = T.join(result, value, arm.body); }
          catch { throw new Diagnostic('E0308', `Incompatible match arm types ${result} and ${value}`, arm.body.span); }
          ctx.pop();
        }
        const shape = this.index.enums.get(T.application(scrutinee).name);
        const full = wildcard || (scrutinee === 'bool' && coverage.has('true') && coverage.has('false')) ||
          (shape && shape.variants.every(v => coverage.has(`${shape.name}::${v.name}`)));
        if (!full) throw new Diagnostic('E0004', 'Non-exhaustive match requires wildcard arm or all variants', node.span);
        type = result; break;
      }
      case 'try': {
        const value = this.infer(node.value, ctx), application = T.application(value), ret = T.application(ctx.instance.returnType);
        if (!['Result', 'Option'].includes(application.name) || application.name !== ret.name)
          throw new Diagnostic('E0277', '? requires a matching Option/Result function return type', node.span);
        if (application.name === 'Result') T.unify(ret.args[1], application.args[1], new Map(), node);
        node.family = application.name; type = application.args[0]; break;
      }
      case 'intrinsic': type = this.intrinsic(node, ctx, expected); break;
      case 'call': type = node.macro ? this.intrinsic({...node, name: node.callee.name}, ctx, expected, node) : this.call(node, ctx, expected); break;
      default: throw new Diagnostic('F0203', `No type rule for '${node.kind}'`, node.span);
    }
    node.copy = this.hasTrait(type, 'Copy');
    if(this.closures.get(type)?.node.borrowCarrier)node.borrowCarrier=true;
    return this.annotate(node, type);
  }
  construct(node, constructor, args, ctx, expected) {
    const {owner, variant, tag} = constructor;
    if (variant.fields.length !== args.length) throw new Diagnostic('E0061', `${tag} expects ${variant.fields.length} values`, node.span);
    const hint = T.application(expected ?? ''), substitution = new Map(owner.generics.map((g, i) => [g.name, hint.name === owner.name ? hint.args[i] : null]));
    args.forEach((arg, i) => {
      const formal = T.substitute(variant.fields[i], substitution);
      T.unify(formal, this.infer(arg, ctx, substitution.has(formal) ? null : formal), substitution, arg);
    });
    const type = owner.name + (owner.generics.length ? '<' + owner.generics.map(g => substitution.get(g.name) ?? '_').join(',') + '>' : '');
    node.variant = tag; node.args = args;
    return type;
  }
  pattern(pattern, type, ctx, mutable = false) {
    pattern.type = type;
    if (pattern.kind === 'wildcard') return '*';
    if (pattern.kind === 'bindingPattern') {
      pattern.binding = ctx.declare(pattern.name, type, mutable, pattern); return '*';
    }
    if (pattern.kind === 'literal' || pattern.kind === 'unary') {
      T.unify(type, this.infer(pattern, ctx, type), new Map(), pattern); return String(pattern.value);
    }
    if (pattern.kind === 'tuplePattern') {
      const parts = type.startsWith('(') ? T.split(type.slice(1, -1)) : [];
      if (parts.length !== pattern.items.length) throw new Diagnostic('E0527', 'Tuple pattern arity does not match', pattern.span);
      pattern.items.forEach((p, i) => this.pattern(p, parts[i], ctx, mutable)); return '*';
    }
    if (pattern.kind === 'variantPattern') {
      const constructor = this.index.constructorFor(pattern.name, ctx.instance.fn.module), application = T.application(type);
      if (!constructor || constructor.owner.name !== application.name) throw new Diagnostic('E0532', `Pattern ${pattern.name} does not match ${type}`, pattern.span);
      if (constructor.variant.fields.length !== pattern.items.length) throw new Diagnostic('E0023', 'Variant pattern arity mismatch', pattern.span);
      const substitution = new Map(constructor.owner.generics.map((g, i) => [g.name, application.args[i]]));
      pattern.variant = constructor.tag;
      pattern.items.forEach((p, i) => this.pattern(p, T.substitute(constructor.variant.fields[i], substitution), ctx, mutable));
      return pattern.variant;
    }
    throw new Diagnostic('F_PATTERN', `Pattern ${pattern.kind} is not implemented`, pattern.span);
  }
  place(node, ctx, mutable) {
    if (node.kind === 'variable' && node.binding) {
      if (mutable && !node.binding.mutable) throw new Diagnostic('E0596', `Cannot assign to immutable variable ${node.name}`, node.span);
      return node.binding;
    }
    if (node.kind === 'unary' && node.op === '*') {
      if (mutable && !node.value.type.startsWith('&mut ')) throw new Diagnostic('E0594', 'Cannot write through a shared reference', node.span);
      return node.value.binding ?? null;
    }
    if (node.kind === 'field' || node.kind === 'index') {
      if (node.autoDeref) {
        if (mutable && !node.object.type.startsWith('&mut ')) throw new Diagnostic('E0594', 'Cannot modify through shared reference', node.span);
        return node.object.binding ?? null;
      }
      return this.place(node.object, ctx, mutable);
    }
    throw new Diagnostic('E0070', 'Expression is not an assignable place', node.span);
  }
  intrinsic(node, ctx, expected, destination = node) {
    const name = node.name, args = node.args;
    destination.builtin = name;
    if (name === 'vec') {
      const hint = T.application(expected ?? '').name === 'Vec' ? T.application(expected).args[0] : null;
      const type = args.length ? this.infer(args[0], ctx, hint) : hint;
      if (!type) throw new Diagnostic('E0282', 'Empty vec! needs a Vec<T> annotation', node.span);
      args.slice(1).forEach(a => T.unify(type, this.infer(a, ctx, type), new Map(), a));
      return `Vec<${type}>`;
    }
    if (name === 'assert') {
      if (args.length !== 1) throw new Diagnostic('E0061', 'assert! currently accepts one condition', node.span);
      T.unify('bool', this.infer(args[0], ctx, 'bool'), new Map(), args[0]); return '()';
    }
    if (name === 'assert_eq') {
      if (args.length !== 2) throw new Diagnostic('E0061', 'assert_eq! expects two values', node.span);
      const first = this.infer(args[0], ctx); T.unify(first, this.infer(args[1], ctx, first), new Map(), args[1]); return '()';
    }
    if (name === 'dbg') {
      if (args.length !== 1) throw new Diagnostic('E0061', 'dbg! expects one expression', node.span);
      return this.infer(args[0], ctx, expected);
    }
    if (!['println', 'print', 'format', 'panic'].includes(name)) throw new Diagnostic('F_MACRO', `Unsupported macro ${name}!`, node.span);
    if (!args.length && name === 'println') { destination.format = {parts: [], argumentCount: 0}; return '()'; }
    if (args[0]?.kind !== 'literal' || args[0].type !== '&str') throw new Diagnostic('E_FMT', 'Formatting requires a string literal', node.span);
    const format = FormatParser.parse(args[0].value, node);
    if (format.argumentCount !== args.length - 1) throw new Diagnostic('E_FMT', 'Format argument count mismatch', node.span);
    destination.format = format;
    args.slice(1).forEach((arg, i) => {
      const type = this.infer(arg, ctx), debug = format.parts.find(p => p.argument === i)?.debug;
      if (!this.hasTrait(type, debug ? 'Debug' : 'Display')) throw new Diagnostic('E0277', `${type} does not implement ${debug ? 'Debug' : 'Display'}`, arg.span);
    });
    return name === 'format' ? 'String' : name === 'panic' ? '!' : '()';
  }
  call(node, ctx, expected) {
    if(!['variable','field'].includes(node.callee.kind)||(node.callee.kind==='variable'&&ctx.lookup(node.callee.name,node.callee,false))){
      const type=this.infer(node.callee,ctx),closure=this.closures.get(type);
      if(closure)return this.closures.call(node,ctx,type);
      if(node.callee.kind!=='field')throw new Diagnostic('E0618',`${type} is not callable`,node.callee.span);
    }
    const callee = node.callee;
    if (callee.kind === 'field') return this.method(node, ctx, expected);
    if (callee.kind !== 'variable') throw new Diagnostic('F_CALL', 'This callee is not yet callable', node.span);
    const name = callee.name;
    if (name === 'String::from') {
      if (node.args.length !== 1) throw new Diagnostic('E0061', 'String::from expects one argument', node.span);
      T.unify('&str', this.infer(node.args[0], ctx, '&str'), new Map(), node);
      node.builtin = 'String::from'; return 'String';
    }
    if (name === 'Vec::new') {
      const type = callee.typeArguments?.[0] ?? T.application(expected ?? '').args[0];
      if (!type || T.application(expected ?? `Vec<${type}>`).name !== 'Vec') throw new Diagnostic('E0282', 'Vec::new requires an element type', node.span);
      if (node.args.length) throw new Diagnostic('E0061', 'Vec::new expects no arguments', node.span);
      node.builtin = 'Vec::new'; return `Vec<${type}>`;
    }
    if (name === 'clone') {
      if (node.args.length !== 1) throw new Diagnostic('E0061', 'clone expects one value', node.span);
      const type = this.infer(node.args[0], ctx, expected);
      if (!this.hasTrait(type, 'Clone')) throw new Diagnostic('E0277', `${type} does not implement Clone`, node.span);
      node.builtin = 'clone'; return type;
    }
    const constructor = this.index.constructorFor(name, ctx.instance.fn.module);
    if (constructor) return this.construct(node, constructor, node.args, ctx, expected);
    const fn = this.index.resolve(this.index.functions, name, ctx.instance.fn.module, node);
    const explicit = (callee.typeArguments ?? []).map(t => this.normalize(t, ctx));
    const mapping = new Map(fn.generics.map((g, i) => [g.name, explicit[i] ?? null]));
    const types = node.args.map((arg, i) => {
      const formal = fn.params[i] && this.index.type(T.substitute(fn.params[i].type, mapping), fn.module, fn.owner);
      return this.infer(arg, ctx, formal && !mapping.has(formal) ? formal : null);
    });
    const instance = this.instantiate(fn, types, explicit, node);
    node.resolved = instance.key;
    ctx.instance.calls.push({to: instance.key, span: node.span, loc: node.loc});
    return instance.returnType;
  }
  method(node, ctx) {
    const receiver = node.callee.object, method = node.callee.field;
    const original = this.infer(receiver, ctx), base = T.reference(original) && original !== '&str' ? T.target(original) : original;
    const app = T.application(base), array = /^\[(.+);\d+\]$/.exec(base);
    const builtins = ['len', 'clone', 'push', 'pop', 'push_str', 'to_string', 'unwrap', 'is_some', 'is_none', 'is_ok', 'is_err'];
    if (builtins.includes(method)) {
      node.receiver = receiver; node.receiverDeref = base !== original; node.builtin = `method::${method}`;
      if (['push', 'pop', 'push_str'].includes(method) && T.reference(original) && !original.startsWith('&mut '))
        throw new Diagnostic('E0596', 'Cannot mutate through a shared reference', receiver.span);
      const expectCount = ['push', 'push_str'].includes(method) ? 1 : 0;
      if (node.args.length !== expectCount) throw new Diagnostic('E0061', `${method} expects ${expectCount} argument(s)`, node.span);
      if (method === 'len' && (array || app.name === 'Vec' || ['String', '&str'].includes(base))) return 'usize';
      if (method === 'clone' && this.hasTrait(base, 'Clone')) return base;
      if (method === 'to_string' && this.hasTrait(base, 'Display')) return 'String';
      if (['push', 'pop'].includes(method) && app.name === 'Vec') {
        if (original.startsWith('&mut ')) node.receiverDeref = true; else this.place(receiver, ctx, true);
        if (method === 'push') { T.unify(app.args[0], this.infer(node.args[0], ctx, app.args[0]), new Map(), node); return '()'; }
        return `Option<${app.args[0]}>`;
      }
      if (method === 'push_str' && base === 'String') {
        if (!original.startsWith('&mut ')) this.place(receiver, ctx, true);
        T.unify('&str', this.infer(node.args[0], ctx, '&str'), new Map(), node); return '()';
      }
      if (['Option', 'Result'].includes(app.name)) {
        if (method === 'unwrap') return app.args[0];
        if ((app.name === 'Option' && ['is_some', 'is_none'].includes(method)) || (app.name === 'Result' && ['is_ok', 'is_err'].includes(method))) return 'bool';
      }
    }
    const fn = this.index.resolve(this.index.functions, `${base}::${method}`, ctx.instance.fn.module, node, false);
    if (!fn) throw new Diagnostic('E0599', `No method '${method}' for ${base}`, node.span);
    let first = receiver;
    const formal = this.index.type(fn.params[0]?.type ?? '', fn.module, fn.owner);
    if (T.reference(formal) && !T.reference(original)) {
      first = {kind: 'unary', op: '&', mutable: formal.startsWith('&mut '), value: receiver, span: receiver.span, loc: receiver.loc};
    }
    node.args = [first, ...node.args];
    const types = node.args.map((arg, i) => this.infer(arg, ctx, fn.params[i]?.type));
    const instance = this.instantiate(fn, types, [], node);
    node.resolved = instance.key; delete node.builtin; delete node.receiver;
    ctx.instance.calls.push({to: instance.key, span: node.span, loc: node.loc}); return instance.returnType;
  }
  block(block, ctx, expected = null) {
    ctx.push(); let flow = '()';
    for (const statement of block.body) {
      if (flow === '!') this.warnings.push({severity: 'warning', code: 'W_UNREACHABLE', message: 'Unreachable statement', span: statement.span});
      const result = this.statement(statement, ctx);
      if (result === '!') flow = '!';
    }
    const tail = block.tail ? this.infer(block.tail, ctx, expected) : '()';
    const type = flow === '!' ? '!' : tail;
    ctx.pop(); return this.annotate(block, type);
  }
  statement(node, ctx) {
    let type = '()';
    switch (node.kind) {
      case 'let': {
        const annotation = node.annotation ? this.normalize(node.annotation, ctx) : null;
        const actual = this.infer(node.value, ctx, annotation);
        if (annotation) T.unify(annotation, actual, new Map(), node);
        this.pattern(node.pattern, annotation ?? actual, ctx, node.mutable);
        node.binding = node.pattern.binding; break;
      }
      case 'assign': {
        const target = this.infer(node.target, ctx); this.place(node.target, ctx, true);
        T.unify(target, this.infer(node.value, ctx, target), new Map(), node);
        if (node.op !== '=' && !T.numeric(target)) throw new Diagnostic('E0368', 'Compound assignment requires a number', node.span);
        break;
      }
      case 'return': {
        const expected=ctx.instance.returnType;
        const actual=this.infer(node.value,ctx,expected==='_'||expected.startsWith('impl ')?null:expected);
        if(expected==='_'||expected.startsWith('impl '))ctx.inferredReturns.push(actual);
        else T.unify(expected,actual,new Map(),node);
        type = '!'; break;
      }
      case 'break': case 'continue': {
        const loop = ctx.loops.at(-1);
        if (!loop) throw new Diagnostic('E0268', `${node.kind} outside a loop`, node.span);
        if (node.kind === 'break') {
          const value = this.infer(node.value, ctx);
          if (loop.kind !== 'loop' && value !== '()') throw new Diagnostic('E0571', 'Only loop expressions support break values', node.span);
          loop.type = T.join(loop.type, value, node);
        }
        type = '!'; break;
      }
      case 'expression': this.infer(node.value, ctx); type = node.value.type === '!' ? '!' : '()'; break;
      case 'whileLet': {
        const scrutinee = this.infer(node.value, ctx);
        ctx.push(); this.pattern(node.pattern, scrutinee, ctx);
        ctx.loops.push({kind: 'while', type: '!', breaks: []});
        T.unify('()', this.block(node.then, ctx, '()'), new Map(), node.then);
        ctx.loops.pop(); ctx.pop(); break;
      }
      case 'while': {
        T.unify('bool', this.infer(node.condition, ctx, 'bool'), new Map(), node);
        ctx.loops.push({kind: 'while', type: '!', breaks: []});
        T.unify('()', this.block(node.then, ctx, '()'), new Map(), node.then);
        ctx.loops.pop(); break;
      }
      case 'for': {
        const from = this.infer(node.from, ctx); let element;
        if (node.to) {
          const to = this.infer(node.to, ctx, from);
          if (from !== to || !T.integer(from)) throw new Diagnostic('E0308', 'For range requires matching integer types', node.span);
          element = from;
        } else {
          element = /^\[(.+);\d+\]$/.exec(from)?.[1] ?? (T.application(from).name === 'Vec' ? T.application(from).args[0] : null);
          if (!element) throw new Diagnostic('E0277', `Cannot iterate ${from}`, node.span);
        }
        ctx.push(); this.pattern(node.pattern, element, ctx, false); node.binding = node.pattern.binding;
        ctx.loops.push({kind: 'for', type: '!', breaks: []});
        T.unify('()', this.block(node.then, ctx, '()'), new Map(), node.then);
        ctx.loops.pop(); ctx.pop(); break;
      }
      default: throw new Diagnostic('F_STATEMENT', `Unsupported statement ${node.kind}`, node.span);
    }
    return this.annotate(node, type);
  }
}
