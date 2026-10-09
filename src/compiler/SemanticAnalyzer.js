import {ImplementationResolver} from './ImplementationResolver.js';
import {FunctionValueAnalyzer} from './FunctionValueAnalyzer.js';
import {EnumDiscriminants} from './EnumDiscriminants.js';
import {StructAnalyzer} from './StructAnalyzer.js';
import {AssigneeAnalyzer} from './assignments/AssigneeAnalyzer.js';
import {ConstantEvaluator} from './ConstantEvaluator.js';
import {PatternAnalyzer} from './patterns/PatternAnalyzer.js';
import {PatternCoverage} from './patterns/PatternCoverage.js';
import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {SymbolIndex} from './SymbolIndex.js';
import {FunctionContext} from './FunctionContext.js';
import {FormatParser} from './FormatParser.js';
import {SemanticQueryCache} from './SemanticQueryCache.js';
import {ClosureAnalyzer} from './closures/ClosureAnalyzer.js';

/** Monomorphized typed HIR. Every local has an identity independent of its spelling. */
export class SemanticAnalyzer {
  constructor(ast, {entry = 'main', mode = 'run', maxInstances = 2048, queryCache = null, constEvaluation = {}} = {}) {
    this.index = new SymbolIndex(ast, {validate: false});
    // Synthesized closure declarations belong to this analysis session. Never replay
    // cached callers without their anonymous declaration/capture environment.
    if(JSON.stringify(ast).includes('"kind":"closure"')||FunctionValueAnalyzer.requiresFreshQueries(ast,this.index))queryCache=null;
    this.functionValues=new FunctionValueAnalyzer(this);this.closures=new ClosureAnalyzer(this); this.structures = new StructAnalyzer(this);
    this.patterns = new PatternAnalyzer(this); this.coverage = new PatternCoverage(this.index); this.patternReports = [];
    this.queryCache = queryCache; this.environment = queryCache ? SemanticQueryCache.environment(this.index) : null;
    this.instances = new Map(); this.obligations = []; this.warnings = [];
    this.entry = entry; this.mode = mode; this.maxInstances = maxInstances; this.depth = 0;
    this.constants = new ConstantEvaluator(this, constEvaluation);
    this.discriminants = new EnumDiscriminants(this);
    this.index.constantEvaluator = this.constants;
    this.implementations = new ImplementationResolver(this);
    this.index.typeResolver.validate();
    this.implementations.validate();
  }
  static analyze(ast, options) { return new SemanticAnalyzer(ast, options).analyze(); }
  analyze() {
    this.discriminants.validate();
    for (const constant of this.index.constants.values()) this.constants.constant(constant);
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
    for (const instance of this.instances.values()) if (instance.fn.isConst) this.constants.validate(instance);
    this.closures.finish();this.functionValues.finish();
    this.discriminants.annotate(this.instances.values());
    return {implementations: this.implementations.snapshot(), discriminants: this.discriminants.snapshot(), functionItems:this.functionValues.snapshot(),constants: this.constants.snapshot(), typeResolution: this.index.typeResolver.snapshot(), patterns: this.patternReports, closures:this.closures.snapshot(), instances: [...this.instances.values()], obligations: this.obligations,
      symbols: this.index.symbols, structures: [...this.index.structs.values()],
      enums: [...this.index.enums.values()], warnings: this.warnings, entry: this.entryKey,
      capabilities: {ownership: 'conservative whole-local analysis', traits: 'concrete impls and built-in bounds'}};
  }
  annotate(node, type) { node.type = type; return type; }
  normalize(type, ctx, node = null) { return this.index.type(T.substitute(type, ctx.instance.substitution ?? new Map(Object.entries(ctx.instance.typeArguments))), ctx.instance.fn.module, ctx.instance.fn.owner, new Set(), node); }
  hasTrait(type, bound, depth = 0) {
    if (depth > 32) return false;
    const closure=this.closures.get(type);
    if(ClosureAnalyzer.bound(bound))return (this.functionValues.get(type)||this.functionValues.pointer(type))?this.functionValues.satisfies(type,bound):this.closures.satisfies(type,bound);
    if(!T.reference(type)&&this.functionValues.get(type))return ['Copy','Clone','Send','Sync'].includes(bound);
    if(T.function(type))return ['Copy','Clone','Send','Sync','PartialEq','Eq'].includes(bound);
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
  formal(fn, type, substitution = new Map(), node = fn) {
    const parameters = new Set(substitution.keys());
    const owner = fn.owner ? this.index.type(fn.owner, fn.module, null, parameters, node) : null;
    const expanded = this.index.type(type, fn.module, owner, parameters, node);
    return this.index.type(T.substitute(expanded, substitution), fn.module, null, parameters, node);
  }
  instantiate(fn, argumentTypes, explicit = [], node = fn) {
    if (fn.params.length !== argumentTypes.length) throw new Diagnostic('E0061', `${fn.name} expects ${fn.params.length} argument(s), got ${argumentTypes.length}`, node.span);
    const substitution = new Map(fn.generics.map((g, i) => [g.name, explicit[i] ?? null]));
    if (explicit.length > fn.generics.length) throw new Diagnostic('E0107', 'Too many generic arguments', node.span);
    fn.params.forEach((p, i) => T.unify(this.formal(fn, p.type, substitution, node), argumentTypes[i], substitution, node));
    for (const parameter of fn.generics) {
      const type = substitution.get(parameter.name);
      if (!type || /\b_\b/.test(type)) throw new Diagnostic('E0282', `Cannot infer ${parameter.name} in ${fn.name}`, node.span);
      for (const rawBound of parameter.bounds) {
        const bound=this.formal(fn, rawBound, substitution, node);
        if (!this.hasTrait(type, bound)) throw new Diagnostic('E0277', `Trait obligation failed: ${type}: ${bound}`, node.span);
        this.obligations.push({type, trait: bound, status: 'satisfied', span: node.span});
      }
    }
    for (const predicate of fn.predicates ?? []) {
      const type = this.formal(fn, predicate.type, substitution, node);
      for (const rawBound of predicate.bounds) {
        const bound = this.formal(fn, rawBound, substitution, node);
        if (!this.hasTrait(type, bound)) throw new Diagnostic('E0277', `Where-clause obligation failed: ${type}: ${bound}`, node.span, [{message: 'Required by this bound', span: predicate.span}]);
        this.obligations.push({type, trait: bound, status: 'satisfied', span: node.span, declaration: predicate.span});
      }
    }
    const key = fn.name + '<'  + fn.generics.map(g => substitution.get(g.name)).join(',') + '>';
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
      this.patternReports.push(...structuredClone(query.value.patternReports ?? [])); this.warnings.push(...structuredClone(query.value.warnings)); this.depth--; return instance;
    }
    const warningStart = this.warnings.length, patternStart = this.patternReports.length;
    const copy = structuredClone(fn);
    const instance = {key, name: fn.name, fn: copy, substitution, typeArguments: Object.fromEntries(substitution),
      returnType: this.formal(fn, fn.returnType, substitution, fn), calls: [], locals: []};
    this.instances.set(key, instance);
    const ctx = new FunctionContext(instance);
    copy.owner = fn.owner ? this.index.type(T.substitute(fn.owner, substitution), fn.module, null, new Set(), fn) : null;
    copy.params.forEach((p, i) => { p.type = argumentTypes[i]; p.binding = ctx.declare(p.name, p.type, p.mutable, p, true); });
    ctx.inferredReturns=[];
    const abstractReturn=instance.returnType.startsWith('impl ')?instance.returnType.slice(5):null;
    const actual = this.block(copy.body, ctx, instance.returnType==='_'||abstractReturn?null:instance.returnType);
    if(instance.returnType==='_'||abstractReturn){
      const inferred=ctx.inferredReturns.reduce((type,next)=>T.join(type,next,copy.body),actual);
      if(abstractReturn&&!this.hasTrait(inferred,abstractReturn))throw new Diagnostic('E0277',`Returned type does not implement ${abstractReturn}`,copy.body.span);
      instance.returnType=inferred;
    }else T.unify(instance.returnType, actual, new Map(), copy.body);
    if (fn.implGenericCount && new AssigneeAnalyzer(this, ctx).carriesReference(instance.returnType))
      throw new Diagnostic('F_IMPL_REFERENCE', 'Reference-carrying generic method results require interprocedural loan tracking', node.span);
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
      this.queryCache.store(query, {instance, dependencies, warnings, patternReports: this.patternReports.slice(patternStart)});
    }
    this.depth--;
    return instance;
  }
  infer(node, ctx, expected = null) {
    if (!node) return '()';
    let type;
    switch (node.kind) {
      case 'constBlock': {
        const result = this.constants.expression(node.value, ctx.instance.fn.module, expected ?? '_', node);
        node.kind = 'constValue'; node.value = structuredClone(result.expression); type = result.type; break;
      }
      case 'assign': case 'return': case 'break': case 'continue':
      case 'while': case 'whileLet': case 'for': return this.statement(node, ctx);
      case 'functionPointer':case 'functionCoercion':type=node.pointerSignature;break;
      case 'functionItem': type=this.functionValues.canonical(node.itemType);break;
      case 'closure': type=this.closures.create(node,ctx);break;
      case 'literal': {
        type = node.type;
        if (type === '{integer}') type = expected && T.integer(expected) ? expected : 'i32';
        if (type === 'f64' && node.suffix == null && expected === 'f32') type = 'f32';
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
        if (binding) { node.binding = binding; type = this.functionValues.canonical(binding.type); break; }
        const constant = this.index.resolve(this.index.constants, node.name, ctx.instance.fn.module, node, false);
        if (constant) {
          const result = this.constants.constant(constant, node);
          node.constant = structuredClone(result.expression); type = result.type; break;
        }
        const constructor = this.index.constructorFor(node.name === 'Self' ? ctx.instance.fn.owner : node.name.startsWith('Self::') && ctx.instance.fn.owner ? ctx.instance.fn.owner + node.name.slice(4) : node.name, ctx.instance.fn.module, node);
        if(constructor?.form==='tuple'){type=this.functionValues.create(node,constructor,ctx,expected);break;}
        if (constructor?.kind === 'struct') { type = this.structures.construct(node, constructor, [], ctx, expected); break; }
        if (constructor && !constructor.variant.fields.length) { type = this.construct(node, constructor, [], ctx, expected); break; }
        const associated = this.implementations.associated(node, ctx);
        const fn = associated?.fn ?? this.index.resolve(this.index.functions,node.name,ctx.instance.fn.module,node,false);
        if(fn){type=this.functionValues.create(node,fn,ctx,expected,associated ? this.implementations.explicit(associated, node, ctx) : null);break;}
        throw new Diagnostic('E0425', `Unresolved identifier '${node.name}'`, node.span);
      }
      case 'tuple': {
        const hints = T.tuple(expected ?? '') ?? [];
        type = T.tupleName(node.items.map((n, i) => this.infer(n, ctx, hints[i]))); break;
      }
      case 'array': {
        const hint = T.array(expected ?? '')?.element;
        let itemType = node.items.length ? '!' : hint;
        if (!node.items.length && !hint) throw new Diagnostic('E0282', 'Empty array needs a type annotation', node.span);
        for (const item of node.items) {
          // Preserve contextual inference for e.g. [Some(4), None]. Distinct
          // item/closure types are instead joined at the array coercion site.
          const contextual = hint ?? (itemType !== '!' && !this.functionValues.get(itemType) && !this.closures.get(itemType) ? itemType : null);
          const actual = this.infer(item, ctx, contextual);
          if (itemType === '!') itemType = actual;
        }
        if(node.items.length)itemType=this.functionValues.join(node.items,ctx,node);
        type = `[${itemType};${node.items.length}]`; break;
      }
      case 'repeatArray': {
        const evaluated = this.constants.expression(node.count, ctx.instance.fn.module, 'usize', node.count);
        node.count = structuredClone(evaluated.expression);
        const count = Number(node.count.value);
        if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw new Diagnostic('F0202', 'Array length exceeds the budget', node.span);
        const element = this.infer(node.value, ctx, T.array(expected ?? '')?.element);
        if (count > 1 && !this.hasTrait(element, 'Copy')) throw new Diagnostic('E0277', 'Repeated array element must implement Copy', node.span);
        node.length = count; type = `[${element};${count}]`; break;
      }
      case 'assigneeRest': throw new Diagnostic('F_RANGE_VALUE', 'Full range values are not yet implemented; rest is supported inside destructuring assignees', node.span);
      case 'structLiteral': type = this.structures.literal(node, ctx, expected); break;
      case 'field': {
        const object = this.infer(node.object, ctx), base = T.reference(object) && object !== '&str' ? T.target(object) : object;
        node.autoDeref = base !== object;
        if (base.startsWith('(')) {
          type = T.split(base.slice(1, -1))[Number(node.field)];
          if (!type || !/^\d+$/.test(node.field)) throw new Diagnostic('E0609', `Unknown tuple field ${node.field}`, node.span);
        } else {
          const application = T.application(base), shape = this.index.structs.get(application.name);
          const field = this.index.field(shape, node.field);
          if (!field) throw new Diagnostic('E0609', `Unknown field ${base}.${node.field}`, node.span);
          this.index.fieldVisible(shape, field, ctx.instance.fn.module, node);
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
          const magnitude = node.value.value;
          const literal = {...node.value, value: /^0[xbo]/i.test(magnitude) ? (-BigInt(magnitude)).toString() : '-' + magnitude};
          type = this.infer(literal, ctx, expected);
          if (type.startsWith('u')) throw new Diagnostic('E0600', 'Cannot negate an unsigned integer', node.span);
          node.kind = 'literal'; node.value = literal.value; node.type = type;
          return type;
        }
        const operand = this.infer(node.value, ctx, node.op==='&'?null:expected);
        if (node.op === '&') { this.place(node.value, ctx, node.mutable); type = '&' + (node.mutable ? 'mut ' : '') + operand; }
        else if (node.op === '*') {
          if (!T.reference(operand) || operand === '&str') throw new Diagnostic('E0614', `Cannot dereference ${operand}`, node.span);
          type = T.target(operand);
        } else if (node.op === '!') {
          if (operand !== 'bool' && !T.integer(operand)) throw new Diagnostic('E0600', `Cannot apply ! to ${operand}`, node.span);
          type = operand;
        } else { if (!T.numeric(operand) || operand.startsWith('u')) throw new Diagnostic('E0600', 'Negation requires a signed integer or floating-point number', node.span); type = operand; }
        break;
      }
      case 'binary': {
        const logical = ['&&', '||'].includes(node.op), shift = ['<<', '>>'].includes(node.op);
        const bitwise = ['&', '|', '^'].includes(node.op);
        const left = this.infer(node.left, ctx, logical ? 'bool' : expected && (T.numeric(expected) || bitwise && expected === 'bool') ? expected : null);
        // Shift RHS has its own integer type; unlike arithmetic, u64 << u8 is legal.
        const right = this.infer(node.right, ctx, shift ? null : left);
        if (!shift) T.unify(left, right, new Map(), node);
        if (logical) { T.unify('bool', left, new Map(), node); type = 'bool'; }
        else if (['==', '!=', '<', '>', '<=', '>='].includes(node.op)) {
          if (!T.numeric(left) && !['bool', 'char', '&str', 'String'].includes(left) && !(T.function(left)&&['==','!='].includes(node.op)))
            throw new Diagnostic('F_COMPARE', `Comparison on ${left} is not implemented`, node.span);
          type = 'bool';
        } else if (shift) {
          if (!T.integer(left) || !T.integer(right)) throw new Diagnostic('E0369', 'Shifts require integer operands', node.span);
          type = left;
        } else if (bitwise) {
          if (!T.integer(left) && left !== 'bool') throw new Diagnostic('E0369', 'Bitwise operators require integers or booleans', node.span);
          type = left;
        } else {
          if (!T.numeric(left)) throw new Diagnostic('E0369', `Arithmetic requires numeric operands, got ${left}`, node.span);
          type = left;
        }
        node.operandType = left; break;
      }
      case 'cast': {
        node.target = this.normalize(node.target, ctx, node);
        const source = this.infer(node.value, ctx,T.function(node.target)?node.target:null);
        if(T.function(node.target)){type=node.target;node.kind='pointerCast';break;}
        const enumeration = this.index.enums.get(T.application(source).name);
        if (enumeration && T.integer(node.target)) {
          this.discriminants.checkCast(enumeration, node);
          node.discriminantEnum = enumeration.name;
          node.discriminantType = this.discriminants.representation(enumeration);
          // rustc simplifies direct unit-variant casts as type-system constants,
          // including casts in unexecuted branches. They need no enum layout.
          if (ctx.instance.fn.isConst && node.value.kind === 'variable' && node.value.variant)
            node.discriminantConstant = String(this.discriminants.resolveTag(enumeration.name, node.value.variant));
          type = node.target; break;
        }
        const allowed = T.numeric(source) && T.numeric(node.target) || ['bool', 'char'].includes(source) && T.integer(node.target) || source === 'u8' && node.target === 'char';
        if (!allowed) throw new Diagnostic('E0605', `Invalid primitive cast from ${source} to ${node.target}`, node.span);
        type = node.target; break;
      }
      case 'block': return this.block(node, ctx, expected);
      case 'ifLet': {
        const scrutinee = this.infer(node.value, ctx);
        ctx.push(); this.pattern(node.pattern, scrutinee, ctx);
        const yes = this.block(node.then, ctx, expected); ctx.pop();
        const no = node.otherwise ? this.infer(node.otherwise, ctx, expected) : '()';
        type=node.otherwise?this.functionValues.join([node.then,node.otherwise],ctx,node):T.join(yes,no,node);break;
      }
      case 'ifExpr': {
        T.unify('bool', this.infer(node.condition, ctx, 'bool'), new Map(), node.condition);
        const yes = this.block(node.then, ctx, expected);
        const no = node.otherwise ? this.infer(node.otherwise, ctx, expected) : '()';
        type=node.otherwise?this.functionValues.join([node.then,node.otherwise],ctx,node):T.join(yes,no,node);break;
      }
      case 'loopExpr': case 'labelBlock': {
        const loop = {kind: node.kind === 'labelBlock' ? 'block' : 'loop', id: node.id, label: node.label, type: '!', expected};
        ctx.loops.push(loop);
        const body = this.block(node.then, ctx, loop.kind === 'block' ? expected : '()');
        ctx.loops.pop();
        if (loop.kind === 'block') type = T.join(loop.type, body, node);
        else { T.unify('()', body, new Map(), node.then); type = loop.type; }
        break;
      }
      case 'match': {
        const scrutinee = this.infer(node.value, ctx); let result = '!';
        const patterns = []; let wildcard = false;
        for (const arm of node.arms) {
          ctx.push();
          this.pattern(arm.pattern, scrutinee, ctx, false);
          if (wildcard) this.warnings.push({severity: 'warning', code: 'W_UNREACHABLE', message: 'Unreachable match arm', span: arm.span});
          if (arm.guard) T.unify('bool', this.infer(arm.guard, ctx, 'bool'), new Map(), arm.guard);
          else { patterns.push(arm.pattern); wildcard = this.coverage.analyze(patterns, scrutinee, node).exhaustive; }
          const value = this.infer(arm.body, ctx, expected ?? (result === '!' ? null : result));
          try { result = this.functionValues.join(node.arms.slice(0,node.arms.indexOf(arm)+1).map(a=>a.body),ctx,arm.body); }
          catch { throw new Diagnostic('E0308', `Incompatible match arm types ${result} and ${value}`, arm.body.span); }
          ctx.pop();
        }
        const coverage = this.checkCoverage(patterns, scrutinee, node);
        if (!coverage.exhaustive) throw new Diagnostic('E0004', `Non-exhaustive match: missing ${coverage.witness}`, node.span);
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
    type=this.functionValues.coerce(node,type,expected,ctx);
    node.copy = this.hasTrait(type, 'Copy');
    if(this.closures.get(type)?.node.borrowCarrier)node.borrowCarrier=true;
    return this.annotate(node, type);
  }
  construct(node, constructor, args, ctx, expected) {
    const {owner, variant, tag, form} = constructor;
    if (form === 'record' && node.kind !== 'structLiteral') throw new Diagnostic('E0533', `${tag} requires named-field braces`, node.span);
    if (form === 'unit' && node.kind === 'call') throw new Diagnostic('E0618', `${tag} is a value, not a callable constructor`, node.span);
    if (form === 'tuple' && !['call', 'structLiteral'].includes(node.kind)) throw new Diagnostic('F_CONSTRUCTOR_VALUE', 'Call the tuple constructor directly; function-item values are not yet supported', node.span);
    if (variant.fields.length !== args.length) throw new Diagnostic('E0061', `${tag} expects ${variant.fields.length} values`, node.span);
    const explicit = (node.callee?.ownerTypeArguments ?? node.callee?.typeArguments ?? node.ownerTypeArguments ?? node.typeArguments ?? []).map(type => this.normalize(type, ctx, node));
    if (explicit.length && explicit.length !== owner.generics.length) throw new Diagnostic('E0107', 'Incorrect number of constructor type arguments', node.span);
    const hint = T.application(expected ?? ''), substitution = new Map(owner.generics.map((g, i) => [g.name, explicit[i] ?? constructor.typeArguments?.[i] ?? (hint.name === owner.name ? hint.args[i] : null)]));
    args.forEach((arg, i) => {
      const formal = this.index.type(T.substitute(variant.fields[i], substitution), owner.module, null, new Set(substitution.keys()), node);
      T.unify(formal, this.infer(arg, ctx, substitution.has(formal) ? null : formal), substitution, arg);
    });
    for (const generic of owner.generics) {
      const type = substitution.get(generic.name);
      for (const bound of generic.bounds) this.structures.bound(type ?? '_', bound, owner, substitution, node);
    }
    for (const predicate of owner.predicates ?? []) {
      const type = this.index.type(T.substitute(predicate.type, substitution), owner.module, owner.name);
      for (const bound of predicate.bounds) this.structures.bound(type, bound, owner, substitution, node);
    }
    const type = owner.name + (owner.generics.length ? '<' + owner.generics.map(g => substitution.get(g.name) ?? '_').join(',') + '>' : '');
    node.variant = tag; node.args = args;
    return type;
  }
  pattern(pattern, type, ctx, mutable = false) {
    this.patterns.analyze(pattern, type, ctx, mutable);
  }
  checkCoverage(patterns, type, node, required = false) {
    const report = {...this.coverage.analyze(patterns, type, node), type, span: node.span};
    this.patternReports.push(report);
    if (required && !report.exhaustive) throw new Diagnostic('E0005', `Refutable pattern in local binding; missing ${report.witness}. Use 'let ... else', 'if let', or 'match'`, node.span);
    return report;
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
    if(node.callee.parenthesized||!['variable','field'].includes(node.callee.kind)||(node.callee.kind==='variable'&&(ctx.lookup(node.callee.name,node.callee,false)||this.index.resolve(this.index.constants,node.callee.name,ctx.instance.fn.module,node.callee,false)))){
      const type=this.infer(node.callee,ctx),closure=this.closures.get(type);
      if(this.functionValues.pointer(type))return this.functionValues.callPointer(node,ctx,type);
      if(this.functionValues.get(type))return this.functionValues.call(node,ctx,type);
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
    const constructor = this.index.constructorFor(name === 'Self' ? ctx.instance.fn.owner : name.startsWith('Self::') && ctx.instance.fn.owner ? ctx.instance.fn.owner + name.slice(4) : name, ctx.instance.fn.module, node);
    if (constructor?.kind === 'struct') return this.structures.construct(node, constructor, node.args, ctx, expected);
    if (constructor) return this.construct(node, constructor, node.args, ctx, expected);
    const associated = this.implementations.associated(callee, ctx);
    const fn = associated?.fn ?? this.index.resolve(this.index.functions, name, ctx.instance.fn.module, node);
    const explicit = associated ? this.implementations.explicit(associated, callee, ctx) :
      (callee.typeArguments ?? []).map(t => this.normalize(t, ctx, callee));
    return this.invoke(node, ctx, fn, explicit, expected);
  }
  invoke(node, ctx, fn, explicit = [], expected = null, typedArguments = new Map()) {
    if (fn.params.length !== node.args.length) throw new Diagnostic('E0061', `${fn.localName ?? fn.name} expects ${fn.params.length} argument(s)`, node.span);
    const mapping = new Map(fn.generics.map((g, i) => [g.name, explicit[i] === '_' ? null : explicit[i] ?? null]));
    // Result context is an inference input, not a cast, and never rewrites an
    // already fixed generic argument. Instantiation rechecks every obligation.
    if (expected && expected !== '_' && !expected.startsWith('impl ')) T.unify(this.formal(fn, fn.returnType, mapping, node), expected, mapping, node);
    const types = node.args.map((arg, i) => {
      const formal = this.formal(fn, fn.params[i].type, mapping, node);
      const concrete = ![...mapping].some(([name, type]) => type === null && T.substitute(formal, new Map([[name, '_']])) !== formal);
      const actual = typedArguments.has(i) ? typedArguments.get(i) : this.infer(arg, ctx, concrete || T.function(formal) ? formal : null);
      T.unify(formal, actual, mapping, arg); return actual;
    });
    const instance = this.instantiate(fn, types, fn.generics.map(g => mapping.get(g.name)), node);
    node.resolved = instance.key;
    ctx.instance.calls.push({to: instance.key, span: node.span, loc: node.loc});
    return instance.returnType;
  }
  method(node, ctx, expected = null) {
    const receiver = node.callee.object, method = node.callee.field;
    const original = this.infer(receiver, ctx), base = T.reference(original) && original !== '&str' ? T.target(original) : original;
    const app = T.application(base), array = /^\[(.+);\d+\]$/.exec(base);
    const resolved = this.implementations.lookup(base, method, ctx.instance.fn.module, node);
    const builtins = ['len', 'clone', 'push', 'pop', 'push_str', 'to_string', 'unwrap', 'is_some', 'is_none', 'is_ok', 'is_err'];
    if (!resolved && builtins.includes(method)) {
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
    const fn = resolved?.fn ?? this.index.resolve(this.index.functions, `${base}::${method}`, ctx.instance.fn.module, node, false);
    if (!fn || fn.params[0]?.name !== 'self') throw new Diagnostic('E0599', `No method '${method}' for ${base}`, node.span);
    const explicit = resolved ? this.implementations.explicit(resolved, node.callee, ctx) : [];
    const mapping = new Map(fn.generics.map((g,i) => [g.name, explicit[i] ?? null]));
    let first = receiver, firstType = original;
    const formal = this.formal(fn, fn.params[0].type, mapping, node);
    if (T.reference(formal) && !T.reference(original)) {
      const isPlace = value => value.kind === 'variable' && !!value.binding || value.kind === 'unary' && value.op === '*' ||
        ['field', 'index'].includes(value.kind) && (value.autoDeref || isPlace(value.object));
      if (!isPlace(first)) {
        let name = `__method_receiver${ctx.locals.length}`;
        while (ctx.lookup(name, node, false)) name += '_';
        const binding = ctx.declare(name, original, true, receiver);
        node.temporaryCallee = {value: receiver, binding};
        first = {kind:'variable', name, binding, type:original, copy:this.hasTrait(original,'Copy'), span:receiver.span, loc:receiver.loc};
      }
      this.place(first, ctx, formal.startsWith('&mut '));
      firstType = (formal.startsWith('&mut ') ? '&mut ' : '&') + original;
      first = {kind:'unary', op:'&', mutable:formal.startsWith('&mut '), value:first, type:firstType,
        copy:this.hasTrait(firstType,'Copy'), span:receiver.span, loc:receiver.loc};
    }
    node.args = [first, ...node.args];
    delete node.builtin; delete node.receiver;
    const result = this.invoke(node, ctx, fn, explicit, expected, new Map([[0, firstType]]));
    if ((fn.implGenericCount || node.temporaryCallee) && new AssigneeAnalyzer(this, ctx).carriesReference(result))
      throw new Diagnostic('F_IMPL_REFERENCE', 'Reference-carrying generic method results require interprocedural loan tracking', node.span);
    return result;
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
        const annotation = node.annotation ? this.normalize(node.annotation, ctx, node) : null;
        const actual = this.infer(node.value, ctx, annotation);
        if (annotation) T.unify(annotation, actual, new Map(), node);
        if (node.otherwise && this.block(node.otherwise, ctx) !== '!') throw new Diagnostic('E0308', 'The else branch of let-else must diverge', node.otherwise.span);
        this.pattern(node.pattern, annotation ?? actual, ctx, node.mutable);
        this.checkCoverage([node.pattern], annotation ?? actual, node, !node.otherwise);
        node.binding = node.pattern.binding; break;
      }
      case 'assign': {
        if (AssigneeAnalyzer.accepts(node.target)) { type = new AssigneeAnalyzer(this, ctx).analyze(node); break; }
        const target = this.infer(node.target, ctx); this.place(node.target, ctx, true);
        const shift = ['<<=', '>>='].includes(node.op), bitwise = ['&=', '|=', '^='].includes(node.op);
        const actual = this.infer(node.value, ctx, shift ? null : target);
        if (!shift) T.unify(target, actual, new Map(), node);
        if (shift && (!T.integer(target) || !T.integer(actual)) || bitwise && !T.integer(target) && target !== 'bool' || !shift && !bitwise && node.op !== '=' && !T.numeric(target))
          throw new Diagnostic('E0368', `Invalid operands for ${node.op}`, node.span);
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
        const loop = ctx.control(node);
        if (node.kind === 'break') {
          const value = this.infer(node.value, ctx, loop.expected ?? (loop.type === '!' ? null : loop.type));
          if (!['loop', 'block'].includes(loop.kind) && node.value) throw new Diagnostic('E0571', 'Only loop expressions and labeled blocks support break values', node.span);
          loop.type = T.join(loop.type, value, node);
        }
        type = '!'; break;
      }
      case 'expression': this.infer(node.value, ctx); type = node.value.type === '!' ? '!' : '()'; break;
      case 'whileLet': {
        const scrutinee = this.infer(node.value, ctx);
        ctx.push(); this.pattern(node.pattern, scrutinee, ctx);
        ctx.loops.push({kind: 'while', id: node.id, label: node.label, type: '!'});
        T.unify('()', this.block(node.then, ctx, '()'), new Map(), node.then);
        ctx.loops.pop(); ctx.pop(); break;
      }
      case 'while': {
        T.unify('bool', this.infer(node.condition, ctx, 'bool'), new Map(), node);
        ctx.loops.push({kind: 'while', id: node.id, label: node.label, type: '!'});
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
        ctx.push(); this.pattern(node.pattern, element, ctx, false); this.checkCoverage([node.pattern], element, node, true); node.binding = node.pattern.binding;
        ctx.loops.push({kind: 'for', id: node.id, label: node.label, type: '!'});
        T.unify('()', this.block(node.then, ctx, '()'), new Map(), node.then);
        ctx.loops.pop(); ctx.pop(); break;
      }
      default: throw new Diagnostic('F_STATEMENT', `Unsupported statement ${node.kind}`, node.span);
    }
    return this.annotate(node, type);
  }
}
