import {randomUUID} from '../core/Platform.js';
import {AgentError} from '../core/AgentError.js';

/** Exact bounded line diff. Large changed middles become explicit replacement hunks, not guessed matches. */
export function lineDiff(before, after, maxCells = 200000) {
  const split = value => value.match(/[^\n]*\n|[^\n]+$/g) ?? [], a = split(before), b = split(after);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix, rows = [], coarse = (n + 1) * (m + 1) > maxCells;
  for (let i = 0; i < prefix; i++) rows.push({kind: ' ', text: a[i]});
  if (coarse) { for (let i = 0; i < n; i++) rows.push({kind: '-', text: a[prefix + i]}); for (let j = 0; j < m; j++) rows.push({kind: '+', text: b[prefix + j]}); }
  else {
    const width = m + 1, table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i * width + j] = a[prefix + i] === b[prefix + j] ? 1 + table[(i + 1) * width + j + 1] : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[prefix + i] === b[prefix + j]) { rows.push({kind: ' ', text: a[prefix + i++]}); j++; }
      else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) rows.push({kind: '-', text: a[prefix + i++]});
      else rows.push({kind: '+', text: b[prefix + j++]});
    }
  }
  for (let i = a.length - suffix; i < a.length; i++) rows.push({kind: ' ', text: a[i]});
  let oldLine = 1, newLine = 1, offset = 0, current = null; const hunks = [];
  for (const row of rows) {
    row.oldLine = row.kind === '+' ? null : oldLine++; row.newLine = row.kind === '-' ? null : newLine++;
    if (row.kind === ' ') current = null;
    else { if (!current) { current = {index: hunks.length, start: offset, before: '', after: ''}; hunks.push(current); } if (row.kind === '-') current.before += row.text; else current.after += row.text; }
    if (row.kind !== '-') offset += row.text.length;
  }
  return {rows, hunks, coarse, added: rows.filter(row => row.kind === '+').length, removed: rows.filter(row => row.kind === '-').length};
}

/** Per-project, per-session review and explicit queue. Never auto-sends or inherits an approval. */
export class BrowserTaskState {
  constructor(runtime) { this.runtime = runtime; this.workspace = runtime.workspace; this.store = runtime.store; this.queue = Promise.resolve(); }
  async optional(kind, id, fallback) { try { return await this.store.read(kind, id); } catch (error) { if (error.status === 404) return fallback; throw error; } }
  async begin(id) {
    const snapshot = await this.workspace.snapshot(), existing = await this.optional('reviews', id, null);
    this.workspace.assertCurrent();
    await this.store.write('reviews', id, {workspaceId: this.workspace.identity, first: existing?.first ?? snapshot, last: snapshot});
  }
  async compare(id, scope = 'task') {
    if (!['task','run'].includes(scope)) throw Error('Choose task or last-run changes');
    const review = await this.store.read('reviews', id), after = await this.workspace.snapshot(), before = scope === 'task' ? review.first : review.last;
    if (review.workspaceId !== this.workspace.identity) throw Error('Review belongs to another project');
    const changes = [];
    for (const path of new Set([...Object.keys(before.files), ...Object.keys(after.files)])) {
      const a = before.files[path] ?? null, b = after.files[path] ?? null; if (a === b) continue;
      // Entire texts stay in the checkpoint. UI diff arrays are bounded even for newline-heavy files.
      const oversized = (a?.length ?? 0) + (b?.length ?? 0) > 500000 || (a?.match(/\n/g)?.length ?? 0) + (b?.match(/\n/g)?.length ?? 0) > 20000;
      changes.push({path, before: a, after: b, afterHash: after.hashes[path] ?? null, status: a === null ? 'added' : b === null ? 'removed' : 'modified', diff: oversized ? null : lineDiff(a ?? '', b ?? ''), oversized});
    }
    return {workspaceId: this.workspace.identity, revision: after.revision, scope, changes};
  }
  assertIdle() { this.workspace.assertCurrent(); if (this.runtime.harness.active.size) throw new AgentError('SESSION_BUSY', 'Stop active browser tasks before restoring reviewed changes'); }
  async restore(change, hunkIndex) {
    this.assertIdle(); if (this.runtime.reviewBusy) throw new AgentError('SESSION_BUSY', 'A review restore is already in progress'); this.runtime.reviewBusy = true;
    try {
    let text = change.before;
    if (hunkIndex !== undefined) {
      const hunk = change.diff?.hunks[hunkIndex]; if (!hunk || change.after === null || change.before === null) throw Error('This change cannot be restored as a hunk');
      text = change.after.slice(0, hunk.start) + hunk.before + change.after.slice(hunk.start + hunk.after.length);
    }
    return await this.workspace.apply([{path: change.path, expectedHash: change.afterHash, text}], {label: 'Restore reviewed ' + change.path, signal: this.runtime.lifetime.signal});
    } finally { this.runtime.reviewBusy = false; }
  }
  async items(id) { return this.optional('queues', id, []); }
  updateQueue(id, operation) {
    const task = this.queue.catch(() => {}).then(async () => {
      const items = await this.items(id); this.workspace.assertCurrent(); const result = operation(items);
      if (items.length > 16 || items.reduce((n, item) => n + item.text.length, 0) > 200000) throw Error('Follow-up queue limit reached (16 messages / 200000 characters)');
      await this.store.write('queues', id, items); return result;
    });
    this.queue = task; return task;
  }
  add(id, text) {
    this.validate(text);
    return this.updateQueue(id, items => { const item = {id: randomUUID(), version: 1, text, workspaceId: this.workspace.identity, createdAt: new Date().toISOString()}; items.push(item); return item; });
  }
  validate(text) { if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw Error('Enter 1–100000 characters for a follow-up'); }
  change(id, itemId, version, action, text) {
    return this.updateQueue(id, items => {
      const index = items.findIndex(item => item.id === itemId), item = items[index];
      if (!item || item.version !== version || item.workspaceId !== this.workspace.identity) throw Error('The queued message changed; refresh before editing');
      if (action === 'remove') items.splice(index, 1);
      else if (action === 'edit') { this.validate(text); item.text = text; item.version++; }
      else if (['up','down'].includes(action)) { const target = index + (action === 'up' ? -1 : 1); if (target >= 0 && target < items.length) [items[index], items[target]] = [items[target], items[index]]; }
      else throw Error('Invalid queue operation');
    });
  }
  static patch(comparison) {
    const output = ['# Ferrite project review. Includes manual edits since the checkpoint; not Git staging.'];
    const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    for (const change of comparison.changes) {
      const a = lines(change.before ?? ''), b = lines(change.after ?? '');
      output.push('--- ' + (change.before === null ? '/dev/null' : 'a/' + change.path), '+++ ' + (change.after === null ? '/dev/null' : 'b/' + change.path), `@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@`);
      for (const [sign, values] of [['-', a], ['+', b]]) for (const value of values) { output.push(sign + (value.endsWith('\n') ? value.slice(0, -1) : value)); if (!value.endsWith('\n')) output.push('\\ No newline at end of file'); }
    }
    return output.join('\n') + '\n';
  }
}
