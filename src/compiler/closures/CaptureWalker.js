/** Scope-aware free-variable traversal; shadowing and pattern scopes are not textual replacements. */
export class CaptureWalker {
  static bindings(pattern) {
    if (!pattern) return [];
    if (pattern.kind === 'bindingPattern') return [pattern.name];
    if (pattern.kind === 'referencePattern') return this.bindings(pattern.pattern);
    if (pattern.kind === 'atPattern') return [...this.bindings(pattern.binder), ...this.bindings(pattern.pattern)];
    return [...(pattern.items ?? []).flatMap(p => this.bindings(p)), ...(pattern.fields ?? []).flatMap(f => this.bindings(f.pattern))];
  }
  static parameters(params) { return params.flatMap(p => p.pattern ? this.bindings(p.pattern) : p.name && p.name !== '_' ? [p.name] : []); }
  static patternUse(patterns) {
    const pending = Array.isArray(patterns) ? [...patterns] : [patterns];
    let reference = false, mutable = false, value = false;
    while (pending.length) {
      const node = pending.pop(); if (!node) continue;
      if (node.kind === 'bindingPattern') {
        if (node.byRef) { reference = true; mutable ||= !!node.mutable; }
        else value = true;
      }
      if (node.binder) pending.push(node.binder);
      if (node.pattern) pending.push(node.pattern);
      if (node.items) pending.push(...node.items);
      if (node.fields) pending.push(...node.fields.map(field => field.pattern));
    }
    // Keep the existing conservative value-capture policy when any by-value
    // binder occurs; borrow-only patterns must not invent a move/FnOnce capture.
    return !reference || value ? 'consume' : mutable ? 'mutate' : 'read';
  }
  static transform(node, names, onFree, use = 'read') {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(n => this.transform(n, names, onFree, use));
    const walk = (n, scope = names, mode = 'read') => this.transform(n, scope, onFree, mode);
    if (node.kind === 'variable') return node.name === '_' || names.has(node.name) ? node : onFree(node, use);
    if (node.kind === 'block') {
      const scope = new Set(names), body = [];
      for (const statement of node.body) {
        body.push(walk(statement, scope));
        if (statement.kind === 'let') this.bindings(statement.pattern).forEach(name => scope.add(name));
      }
      return {...node, body, tail: walk(node.tail, scope, 'consume')};
    }
    if (node.kind === 'let') return {...node, value: walk(node.value, names, this.patternUse(node.pattern))};
    if (node.kind === 'return' || node.kind === 'break') return {...node, value: walk(node.value, names, 'consume')};
    if (node.kind === 'assign') return {...node, target: walk(node.target, names, 'mutate'), value: walk(node.value, names, node.target.kind === 'variable' && node.target.name === '_' ? 'read' : 'consume')};
    if (node.kind === 'unary' && node.op === '&') return {...node, value: walk(node.value, names, node.mutable ? 'mutate' : 'read')};
    if (node.kind === 'field' || node.kind === 'index') return {...node, object: walk(node.object, names, use), ...(node.index ? {index: walk(node.index)} : {})};
    if (node.kind === 'closure') return {...node, body: walk(node.body, new Set([...names, ...this.parameters(node.params)]), 'consume')};
    if (node.kind === 'for') return {...node, from: walk(node.from), to: walk(node.to), then: walk(node.then, new Set([...names, ...this.bindings(node.pattern)]))};
    if (node.kind === 'ifChain' || node.kind === 'whileChain') {
      const scope = new Set(names);
      const conditions = node.conditions.map(term => {
        if (term.kind !== 'letCondition') return walk(term, scope);
        const value = walk(term.value, scope, this.bindings(term.pattern).length ? this.patternUse(term.pattern) : 'read');
        this.bindings(term.pattern).forEach(name => scope.add(name));
        return {...term, value};
      });
      return {...node, conditions, then: walk(node.then, scope), otherwise: walk(node.otherwise)};
    }
    if (node.kind === 'ifLet' || node.kind === 'whileLet') return {...node, value: walk(node.value, names, this.patternUse(node.pattern)),
      then: walk(node.then, new Set([...names, ...this.bindings(node.pattern)])), otherwise: walk(node.otherwise)};
    if (node.kind === 'match') return {...node, value: walk(node.value, names, this.patternUse(node.arms.map(arm => arm.pattern))), arms: node.arms.map(arm => {
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
