/** Bounded WebAssembly binary encoding; offsets are byte offsets, never text positions. */
export class WasmBinaryWriter {
  constructor() { this.bytes = []; }
  get length() { return this.bytes.length; }
  byte(value) { if (!Number.isInteger(value) || value < 0 || value > 255) throw Error('Invalid byte'); this.bytes.push(value); return this; }
  append(bytes) { if (this.length + bytes.length > 32_000_000) throw Error('WebAssembly module exceeds 32 MB'); for (const byte of bytes) this.bytes.push(byte); return this; }
  u32(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw Error('Invalid u32');
    do { const byte = value % 128; value = Math.floor(value / 128); this.byte(byte | (value ? 128 : 0)); } while (value);
    return this;
  }
  i32(value) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw Error('Invalid i32');
    let more = true;
    while (more) { const byte = value & 127; value >>= 7; more = !(value === 0 && !(byte & 64) || value === -1 && byte & 64); this.byte(byte | (more ? 128 : 0)); }
    return this;
  }
  string(value) { const bytes = new TextEncoder().encode(value); return this.u32(bytes.length).append(bytes); }
  vector(values, write) { this.u32(values.length); values.forEach(value => write(this, value)); return this; }
  section(id, content) { this.byte(id).u32(content.length); const offset = this.length; this.append(content.bytes); return offset; }
  finish() { return new Uint8Array(this.bytes); }
}
