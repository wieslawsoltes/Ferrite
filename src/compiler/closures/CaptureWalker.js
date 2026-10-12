/** Scope-aware free-variable traversal; shadowing and pattern scopes are not textual replacements. */
export class CaptureWalker {
  static bindings(pattern) {
    if (!pattern) return [];
    if (pattern.kind === 'bindingPattern') return [pattern.name];
    if (pattern.kind === 'atPattern') return [...this.bindings(pattern.binder), ...this.bindings(pattern.pattern)];
    return [...(pattern.items ?? []).flatMap(p => this.bindings(p)), ...(pattern.fields ?? []).flatMap(f => this.bindings(f.pattern))];
  }
  static patternUses(pattern, fallback = 'consume') {
    const modes = new Set(), pending = Array.isArray(pattern) ? [...pattern] : [pattern]; let borrowed = false;
    while (pending.length) {
      const item = pending.pop(); if (!item) continue;
      if (item.kind === 'bindingPattern') {
        if (item.byRef) { borrowed = true; modes.add(item.refMutable ? 'mutate' : 'read'); }
        else modes.add('consume');
      }
      if (item.binder) pending.push(item.binder);
      if (item.pattern) pending.push(item.pattern);
      if (item.items) pending.push(...item.items);
      if (item.fields) pending.push(...item.fields.map(field => field.pattern));
    }
    return borrowed ? [...modes] : [fallback];
  }
  static transform(node, names, onFree, use = 'read') {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(n => this.transform(n, names, onFree, use));
    const walk = (n, scope = names, mode = 'read') => this.transform(n, scope, onFree, mode);
    const scrutinee = (value, patterns, scope = names, fallback = 'consume') => {
      let result;
      for (const mode of this.patternUses(patterns, fallback)) result = walk(value, scope, mode);
      return result;
    };
    if (node.kind === 'variable') return node.name === '_' || names.has(node.name) ? node : onFree(node, use);
    if (node.kind === 'block') {
      const scope = new Set(names), body = [];
      for (const statement of node.body) {
        body.push(walk(statement, scope));
        if (statement.kind === 'let') this.bindings(statement.pattern).forEach(name => scope.add(name));
      }
      return {...node, body, tail: walk(node.tail, scope, 'consume')};
    }
    if (node.kind === 'let') return {...node, value: scrutinee(node.value, [node.pattern])};
    if (node.kind === 'return' || node.kind === 'break') return {...node, value: walk(node.value, names, 'consume')};
    if (node.kind === 'assign') return {...node, target: walk(node.target, names, 'mutate'), value: walk(node.value, names, node.target.kind === 'variable' && node.target.name === '_' ? 'read' : 'consume')};
    if (node.kind === 'unary' && node.op === '&') return {...node, value: walk(node.value, names, node.mutable ? 'mutate' : 'read')};
    if (node.kind === 'field' || node.kind === 'index') return {...node, object: walk(node.object, names, use), ...(node.index ? {index: walk(node.index)} : {})};
    if (node.kind === 'closure') return {...node, body: walk(node.body, new Set([...names, ...node.params.map(p => p.name)]), 'consume')};
    if (node.kind === 'for') return {...node, from: walk(node.from), to: walk(node.to), then: walk(node.then, new Set([...names, ...this.bindings(node.pattern)]))};
    if (node.kind === 'ifChain' || node.kind === 'whileChain') {
      const scope = new Set(names);
      const conditions = node.conditions.map(term => {
        if (term.kind !== 'letCondition') return walk(term, scope);
        const value = scrutinee(term.value, [term.pattern], scope, this.bindings(term.pattern).length ? 'consume' : 'read');
        this.bindings(term.pattern).forEach(name => scope.add(name));
        return {...term, value};
      });
      return {...node, conditions, then: walk(node.then, scope), otherwise: walk(node.otherwise)};
    }
    if (node.kind === 'ifLet' || node.kind === 'whileLet') return {...node, value: scrutinee(node.value, [node.pattern]),
      then: walk(node.then, new Set([...names, ...this.bindings(node.pattern)])), otherwise: walk(node.otherwise)};
    if (node.kind === 'match') return {...node, value: scrutinee(node.value, node.arms.map(arm => arm.pattern)), arms: node.arms.map(arm => {
      const scope = new Set([...names, ...this.bindings(arm.pattern)]);
      return {...arm, guard: walk(arm.guard, scope), body: walk(arm.body, scope, 'consume')};
    })};
    if (node.kind === 'call' && use === 'mutate')
      return {...node, args: node.args.map(arg => walk(arg, names, 'mutate'))};
    if (node.kind === 'call' || node.kind === 'intrinsic') {
      const name = node.name ?? node.callee?.name;
      const borrows = ['println', 'print', 'format', 'assert_eq', 'dbg'].includes(name);
      let callee = node.callee;
      if (callee?.kind === 'field') {
        const method = callee.field;
        callee = {...callee, object: walk(callee.object, names, ['push', 'pop', 'push_str', 'remove'].includes(method) ? 'mutate' : ['unwrap','into_bytes'].includes(method) ? 'consume' : 'read')};
      } else if (callee) callee = walk(callee, names, 'read');
      return {...node, ...(callee ? {callee} : {}), args: node.args.map(arg => walk(arg, names, borrows ? 'read' : 'consume'))};
    }
    if (node.kind === 'structLiteral') return {...node, fields: node.fields.map(f => ({...f, value: walk(f.value, names, use === 'mutate' ? 'mutate' : 'consume')}))};
    const result = {...node};
    for (const key of ['value', 'condition', 'then', 'otherwise', 'left', 'right', 'body', 'items', 'count'])
      if (node[key]) result[key] = walk(node[key], names, ['items', 'value'].includes(key) ? use : 'read');
    return result;
  }
}
