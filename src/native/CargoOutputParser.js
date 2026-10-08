/** Extract Cargo/rustc JSON diagnostics while preserving the unmodified process logs. */
export class CargoOutputParser {
  static parse(text) {
    const messages = [], diagnostics = [], artifacts = [];
    for (const line of text.split('\n')) {
      if (!line.startsWith('{')) continue;
      let value; try { value = JSON.parse(line); } catch { continue; }
      if (!value.reason) continue; messages.push(value);
      if (value.reason === 'compiler-artifact') artifacts.push({packageId: value.package_id, target: value.target, executable: value.executable, filenames: value.filenames, fresh: value.fresh});
      if (value.reason === 'compiler-message') {
        const message = value.message;
        diagnostics.push({severity: message.level, code: message.code?.code ?? 'rustc', message: message.message, rendered: message.rendered,
          spans: (message.spans ?? []).map(s => ({file: s.file_name, byteStart: s.byte_start, byteEnd: s.byte_end, line: s.line_start, column: s.column_start, endLine: s.line_end, endColumn: s.column_end, primary: s.is_primary, label: s.label}))});
      }
    }
    return {messages, diagnostics, artifacts};
  }
}
