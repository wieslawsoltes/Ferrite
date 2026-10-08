/** A source diagnostic is data, not a JavaScript stack trace. Offsets are UTF-16. */
export class Diagnostic extends Error {
  constructor(code, message, span = null, notes = []) {
    super(message);
    this.name = 'Diagnostic';
    this.code = code;
    this.span = span;
    this.notes = notes;
  }
  toJSON() {
    return {severity: 'error', code: this.code, message: this.message, span: this.span, notes: this.notes};
  }
  static require(condition, code, message, node) {
    if (!condition) throw new Diagnostic(code, message, node?.span ?? node ?? null);
  }
}
