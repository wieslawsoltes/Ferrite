/** UTF-16 offsets match textarea and JavaScript string indexing; lookup is logarithmic. */
export class SourceFile {
  constructor(path, text) {
    this.path = path; this.text = text; this.lines = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.lines.push(i + 1);
  }
  position(offset) {
    offset = Math.max(0, Math.min(this.text.length, offset));
    let low = 0, high = this.lines.length;
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (this.lines[mid] <= offset) low = mid; else high = mid; }
    return {line: low + 1, column: offset - this.lines[low] + 1, offset};
  }
  offset(line, column = 1) { return Math.min(this.text.length, (this.lines[Math.max(0, Math.min(this.lines.length - 1, line - 1))] ?? 0) + Math.max(0, column - 1)); }
  span(start, end = start + 1) {
    const a = this.position(start), b = this.position(end);
    return {file: this.path, start: a.offset, end: b.offset, line: a.line, column: a.column, endLine: b.line, endColumn: b.column};
  }
}
