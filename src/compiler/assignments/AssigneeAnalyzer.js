import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';

/** Typed assignee trees, separate from value expressions and binding patterns.
 * No locals are declared, no pattern-match ergonomics are applied, and each
 * destination expression is inferred once. Annotations contain no AST cycles.
 */
export class AssigneeAnalyzer {
  constructor(analyzer, context) { this.a = analyzer; this.ctx = context; this.nodes = 0; }
  static accepts(node) {
    return ['tuple', 'array', 'structLiteral', 'assigneeRest'].includes(node.kind) ||
      node.kind === 'variable' && node.name === '_' || node.kind === 'literal' && node.type === '()';
  }
  analyze(assignment) {
    if (assignment.op !== '=') throw new Diagnostic('E0368', 'Destructuring requires simple assignment', assignment.span);
    this.prepare(assignment.target);
    const hint = this.hint(assignment.target, assignment.value);
    const actual = this.a.infer(assignment.value, this.ctx, hint === '_' ? null : hint);
    if (actual !== '!') this.check(assignment.target, actual);
    assignment.destructuring = true;
    // A Copy projection or wildcard does not consume its non-Copy container.
    // Moving a non-Copy projection retains the existing whole-local analysis.
    assignment.assignmentMoves = this.leaves(assignment.target).some(node => !node.copy);
    assignment.assignmentRhsDiverges = AssigneeAnalyzer.diverges(assignment.value);
    return assignment.assignmentRhsDiverges || this.leaves(assignment.target).some(node => AssigneeAnalyzer.diverges(node)) ? '!' : '()';
  }
  static diverges(node) {
    if (!node) return false;
    if (node.type === '!') return true;
    const any = values => values.some(value => this.diverges(value));
    switch (node.kind) {
      case 'tuple': case 'array': return any(node.items);
      case 'structLiteral': return any(node.fields.map(field => field.value));
      case 'unary': case 'cast': case 'repeatArray': return this.diverges(node.value);
      case 'field': case 'index': return any([node.object, node.index]);
      case 'call': case 'intrinsic': return any([node.receiver, node.temporaryCallee?.value, ...(node.args ?? [])]);
      case 'binary': return this.diverges(node.left) || !['&&', '||'].includes(node.op) && this.diverges(node.right);
      default: return false;
    }
  }
  children(node) {
    return node.assignee === 'struct' ? node.fields.map(field => field.value) : node.items ?? [];
  }
  leaves(node) {
    if (node.assignee === 'place') return [node];
    return this.children(node).flatMap(child => this.leaves(child));
  }
  prepare(node, depth = 0) {
    if (++this.nodes > 16384 || depth > 128)
      throw new Diagnostic('F_ASSIGN_BUDGET', 'Destructuring assignee budget exceeded', node.span);
    if (node.kind === 'variable' && node.name === '_') { node.assignee = 'discard'; node.type = '_'; return; }
    if (node.kind === 'literal' && node.type === '()') { node.assignee = 'tuple'; node.items = []; return; }
    if (node.kind === 'tuple' || node.kind === 'array') {
      node.assignee = node.kind; let rests = 0;
      for (const item of node.items) {
        if (item.kind === 'assigneeRest') { item.assignee = 'rest'; rests++; }
        else this.prepare(item, depth + 1);
      }
      if (rests > 1) throw new Diagnostic('E0527', 'Only one rest is permitted in an assignee sequence', node.span);
      return;
    }
    if (node.kind === 'structLiteral') {
      node.assignee = 'struct'; const module = this.ctx.instance.fn.module;
      const alias = this.a.index.resolve(this.a.index.aliases, node.name, module, node, false);
      const spelling = node.name + (node.typeArguments?.length ? '<' + node.typeArguments.join(',') + '>' : '');
      const resolved = alias ? T.application(this.a.normalize(spelling, this.ctx, node)) : null;
      const shape = this.a.index.resolve(this.a.index.structs, resolved?.name ?? node.name, module, node);
      const supplied = resolved?.args ?? node.typeArguments ?? [];
      if (supplied.length && supplied.length !== shape.generics.length)
        throw new Diagnostic('E0107', 'Incorrect number of assignee type arguments', node.span);
      const substitution = new Map(shape.generics.map((g, i) => [g.name,
        supplied[i] ? this.a.normalize(supplied[i], this.ctx, node) : null]));
      const seen = new Set();
      for (const field of node.fields) {
        const definition = shape.fields.find(entry => entry.name === field.name);
        if (!definition || seen.has(field.name)) throw new Diagnostic('E0062', `Unknown or duplicate field ${field.name}`, field.value.span);
        seen.add(field.name); this.prepare(field.value, depth + 1);
        const hint = this.hint(field.value);
        if (!hint.includes('_')) {
          const formal = this.a.index.type(T.substitute(definition.type, substitution), shape.module);
          T.unify(formal, hint, substitution, field.value);
        }
      }
      if (!node.rest && seen.size !== shape.fields.length)
        throw new Diagnostic('E0063', `Missing fields in ${shape.name} assignee; use '..' to omit fields`, node.span);
      node.name = shape.name;
      node.assigneeHint = shape.name + (shape.generics.length ? '<' + shape.generics.map(g => substitution.get(g.name) ?? '_').join(',') + '>' : '');
      return;
    }
    if (!['variable', 'field', 'index'].includes(node.kind) && !(node.kind === 'unary' && node.op === '*'))
      throw new Diagnostic('E0070', 'Expression is not an assignable place', node.span);
    this.a.infer(node, this.ctx); this.a.place(node, this.ctx, true); node.assignee = 'place';
  }
  hint(node, value = null) {
    if (node.assignee === 'place') return node.type;
    if (node.assignee === 'struct') return node.assigneeHint;
    if (value?.kind === 'block') value = value.tail;
    if (node.assignee === 'tuple') {
      const rest = node.items.findIndex(item => item.assignee === 'rest');
      if (rest < 0) return T.tupleName(node.items.map((item, i) => this.hint(item, value?.items?.[i])));
      // An expression with a declared result already supplies its element types.
      // Literal tuples can additionally receive contextual numeric hints around '..'.
      if (value?.kind !== 'tuple' || value.items.length < node.items.length - 1) return '_';
      const hints = value.items.map(() => '_');
      node.items.forEach((item, i) => {
        if (i === rest) return;
        const index = i < rest ? i : value.items.length - (node.items.length - i);
        hints[index] = this.hint(item, value.items[index]);
      });
      return T.tupleName(hints);
    }
    if (node.assignee === 'array') {
      const hints = node.items.filter(item => item.assignee !== 'rest').map(item => this.hint(item));
      // Length is checked against the actual RHS type, not this contextual hint.
      const hint = hints.find(type => !type.includes('_')) ?? hints.find(type => type !== '_');
      return hint ? `[${hint};_]` : '_';
    }
    return '_';
  }
  check(node, actual) {
    if (node.assignee === 'discard' || node.assignee === 'rest') return;
    if (node.assignee === 'place') {
      T.unify(node.type, actual, new Map(), node);
      if (this.carriesReference(actual)) throw new Diagnostic('F_ASSIGN_REFERENCE',
        'Destructuring reference-carrying values requires projection-sensitive loan tracking; use individual assignments or native Cargo', node.span);
      node.assigneeSourceType = actual; return;
    }
    node.type = actual;
    if (node.assignee === 'struct') {
      T.unify(node.assigneeHint, actual, new Map(), node);
      const app = T.application(actual), shape = this.a.index.structs.get(app.name);
      const substitution = new Map(shape.generics.map((g, i) => [g.name, app.args[i]]));
      for (const field of node.fields) {
        const definition = shape.fields.find(entry => entry.name === field.name);
        this.check(field.value, this.a.index.type(T.substitute(definition.type, substitution), shape.module));
      }
      return;
    }
    const tuple = node.assignee === 'tuple' ? T.tuple(actual) : null;
    const array = node.assignee === 'array' ? T.array(actual) : null;
    if (!tuple && !array) T.mismatch(node.assignee === 'tuple' ? 'tuple' : 'fixed array', actual, node);
    const count = tuple?.length ?? Number(array.length), rest = node.items.findIndex(item => item.assignee === 'rest');
    const minimum = node.items.length - (rest < 0 ? 0 : 1);
    if (!Number.isSafeInteger(count) || count < minimum || rest < 0 && count !== minimum)
      throw new Diagnostic('E0527', `Assignee expects ${rest < 0 ? '' : 'at least '}${minimum} elements, got ${count}`, node.span);
    node.items.forEach((item, i) => {
      if (i === rest) return;
      const index = rest < 0 || i < rest ? i : count - (node.items.length - i);
      item.assigneeIndex = index; this.check(item, tuple ? tuple[index] : array.element);
    });
  }
  carriesReference(type, seen = new Set(), depth = 0) {
    if (type === '&str') return false;
    if (T.reference(type) || depth > 128) return true;
    if (seen.has(type)) return false;
    seen.add(type);
    const visit = value => this.carriesReference(value, seen, depth + 1);
    const tuple = T.tuple(type), array = T.array(type);
    if (tuple) return tuple.some(visit);
    if (array) return visit(array.element);
    const app = T.application(type);
    if (app.args.some(visit)) return true;
    const shape = this.a.index.structs.get(app.name) ?? this.a.index.enums.get(app.name);
    if (!shape) return false;
    const substitution = new Map(shape.generics.map((g, i) => [g.name, app.args[i]]));
    const fields = shape.fields?.map(field => field.type) ?? shape.variants.flatMap(variant => variant.fields);
    return fields.some(field => visit(this.a.index.type(T.substitute(field, substitution), shape.module)));
  }
}
