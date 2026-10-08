/** A common source-span contract for editor, IR, diagnostics and debugger views. */
export class SelectionModel {
  constructor() { this.value = null; this.listeners = new Set(); this.revision = -1; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  reset(revision) { this.revision = revision; this.value = null; this.notify('reset'); }
  select(span, origin, revision = this.revision) {
    if (!span || typeof span.file !== 'string' || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end < span.start || revision !== this.revision) return false;
    this.value = {...span}; this.notify(origin); return true;
  }
  notify(origin) { for (const listener of this.listeners) listener({span: this.value, origin, revision: this.revision}); }
  static overlaps(a, b) {
    if (!a || !b || a.file !== b.file) return false;
    if (a.start === a.end) return a.start >= b.start && a.start < Math.max(b.end, b.start + 1);
    if (b.start === b.end) return b.start >= a.start && b.start < Math.max(a.end, a.start + 1);
    return a.start < b.end && b.start < a.end;
  }
}
