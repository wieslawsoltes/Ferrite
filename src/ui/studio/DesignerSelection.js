/** Track a visual selection across the validated source replacement, not stale editor ranges. */
export function captureDesignerSelection(designer, id, operation) {
  let node = designer.index.get(id);
  if (!node) return null;
  const edited = designer.index.get(operation.node);
  if (operation.op === 'remove' && edited && node.start >= edited.start && node.end <= edited.end)
    node = designer.parents.get(edited.id);
  else if (operation.op === 'move') node = designer.index.get(operation.parent);
  if (!node) return null;
  const insertion = operation.op === 'insert' ? (operation.before ? designer.index.get(operation.before)?.start : edited?.closeStart)
    : operation.op === 'duplicate' ? edited?.end : null;
  // Shared '<' prefixes cannot distinguish a prepended element from the old tag.
  const shift = insertion != null && node.start >= insertion;
  return {start: node.start, shift};
}
export function restoreDesignerSelection(designer, selection, before) {
  if (!selection || !designer) return null;
  const after = designer.source;
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const start = selection.shift ? selection.start + after.length - before.length : selection.start < prefix ? selection.start
    : selection.start >= before.length - suffix ? selection.start + after.length - before.length
    : prefix;
  return designer.nodes.find(node => node.start === start)
    ?? designer.nodes.filter(node => node.start <= start && node.end > start).sort((a,b) => (a.end-a.start)-(b.end-b.start))[0]
    ?? null;
}
