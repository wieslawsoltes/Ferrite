/** Extract every selected RHS value before evaluating any destination place.
 * Only then perform ordinary assignments from left to right. Index/deref
 * effects are therefore evaluated once, and can observe earlier stores.
 * Wildcards/rest emit no projections, regardless of the skipped array length.
 */
export class AssigneeLowerer {
  static lower(lowerer, assignment) {
    const value = lowerer.expr(assignment.value, true);
    if (!lowerer.current) return;
    const stores = [];
    const extract = (target, source) => {
      if (target.assignee === 'discard' || target.assignee === 'rest') return;
      if (target.assignee === 'place') { stores.push({target, value: source}); return; }
      const children = target.assignee === 'struct' ? target.fields.map(field => ({target: field.value, field: field.name})) :
        target.items.map(item => ({target: item, field: item.assigneeIndex}));
      for (const child of children) {
        const next = child.target;
        if (next.assignee === 'discard' || next.assignee === 'rest') continue;
        if (target.assignee === 'variant') {
          let projected = lowerer.emit('payload', {value: source, index: child.field}, next, next.assigneeSourceType ?? next.type);
          if (next.assignee === 'place' && next.copy) {
            const copy = lowerer.register(next.type, next); lowerer.move(copy, projected, next, true); projected = copy;
          }
          extract(next, projected); continue;
        }
        const index = target.assignee === 'array' ? lowerer.literal(String(child.field), 'usize', next) : null;
        const projected = lowerer.emit('get', {value: source, field: index === null ? String(child.field) : undefined,
          index, deref: false, copy: next.assignee === 'place' && !!next.copy}, next, next.assigneeSourceType ?? next.type);
        extract(next, projected);
      }
    };
    extract(assignment.target, value);
    for (const store of stores) {
      if (!lowerer.current) break;
      const place = lowerer.place(store.target);
      if (lowerer.current) lowerer.emit('write', {place, value: store.value}, store.target);
    }
  }
}
