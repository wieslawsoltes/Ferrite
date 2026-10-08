/** Incremental Cargo JSON log presentation. Program output after build-finished is never reinterpreted as Cargo JSON. */
export class CargoLogStream {
  constructor(emit, json = false) { this.emit = emit ?? (() => {}); this.json = json; this.buffer = ''; this.program = false; this.programOutput = ''; }
  accept(event) {
    if (!this.json || event.kind !== 'stdout') { this.emit(event); return; }
    if (this.program) { this.programOutput += event.text; this.emit(event); return; }
    this.buffer += event.text;
    let index;
    while (!this.program && (index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index + 1); this.buffer = this.buffer.slice(index + 1); this.line(line);
    }
    if (this.program && this.buffer) { const text = this.buffer; this.buffer = ''; this.programOutput += text; this.emit({kind:'stdout',text}); }
  }
  line(text) {
    let record; try { record = JSON.parse(text); } catch { this.emit({kind:'stdout',text}); return; }
    if (!record || typeof record !== 'object') { this.emit({kind:'stdout',text}); return; }
    if (record.reason === 'build-finished') { this.program = true; this.emit({kind:'status',text:record.success?'Cargo build finished.\n':'Cargo build failed.\n'}); }
    else if (record.reason === 'compiler-artifact') this.emit({kind:'artifact',text:`${record.fresh?'Fresh':'Built'} ${record.target?.name??record.package_id??'crate'}\n`});
    else if (record.reason === 'compiler-message') this.emit({kind:'diagnostic',text:record.message?.rendered??`${record.message?.level??'diagnostic'}: ${record.message?.message??'Cargo diagnostic'}\n`});
    else if (record.reason === 'build-script-executed') this.emit({kind:'status',text:`Build script completed: ${record.package_id??'crate'}\n`});
    else this.emit({kind:'stdout',text});
  }
  finish() { if (this.buffer) { const text=this.buffer;this.buffer='';this.line(text); } }
}
