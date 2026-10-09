/** xterm.js 6.0.0 compatibility adapter, deliberately version-pinned with the
 * vendored engine. SerializeAddon preserves cells/SGR/common modes, but not
 * margins, tab stops, saved cursors/attributes, charset banks or pending wrap.
 * These bounded, data-only fields complete a ground-state checkpoint. No parser
 * callbacks, OSC/DCS payloads, DOM nodes or executable objects cross the wire.
 * An engine upgrade must pass the differential checkpoint tests before release.
 */
export function xtermCore(terminal) {
  const core = terminal?._core;
  if (core?._inputHandler?._parser?._transitions?.table?.length !== 4095 || !core._bufferService?.buffers?.normal || !core._charsetService || !core._inputHandler._curAttrData?.extended) throw Error('Unsupported xterm checkpoint ABI; expected pinned xterm.js 6.0.0');
  return core;
}
const attribute = value => ({fg: value.fg, bg: value.bg, extended: value.extended._ext});
const charset = value => value ? {...value} : null;
const bufferState = buffer => ({x: buffer.x, y: buffer.y, savedX: buffer.savedX, savedOffsetY: buffer.savedY - buffer.ybase,
  scrollTop: buffer.scrollTop, scrollBottom: buffer.scrollBottom, tabs: Object.keys(buffer.tabs).filter(key => buffer.tabs[key]).map(Number),
  savedAttribute: attribute(buffer.savedCurAttrData), savedCharset: charset(buffer.savedCharset)});
export function captureTerminalState(terminal) {
  const core = xtermCore(terminal), parser = core._inputHandler._parser;
  if (parser.currentState !== 0) throw Error('Terminal checkpoint requires a complete control-sequence boundary');
  return {abi: 'xterm-6.0.0/1', cols: terminal.cols, rows: terminal.rows,
    normal: bufferState(core._bufferService.buffers.normal), alternate: bufferState(core._bufferService.buffers.alt),
    charset: {level: core._charsetService.glevel, banks: Array.from({length: 4}, (_, index) => charset(core._charsetService._charsets[index])), active: charset(core._charsetService.charset)},
    attribute: attribute(core._inputHandler._curAttrData), joinState: parser.precedingJoinState};
}
function integer(value, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw Error('Invalid terminal checkpoint integer'); return value; }
function readAttribute(value) { return {fg: integer(value?.fg, -2147483648, 4294967295), bg: integer(value?.bg, -2147483648, 4294967295), extended: integer(value?.extended, -2147483648, 4294967295)}; }
function readCharset(value) {
  if (value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 128) throw Error('Invalid terminal checkpoint charset');
  const result = Object.create(null);
  for (const [key, text] of Object.entries(value)) {
    if (key.length !== 1 || key.charCodeAt(0) > 127 || typeof text !== 'string' || text.length > 8) throw Error('Invalid terminal checkpoint charset entry');
    result[key] = text;
  }
  return result;
}
function readBuffer(value, cols, rows) {
  if (!Array.isArray(value?.tabs) || value.tabs.length > 500) throw Error('Invalid terminal checkpoint tabs');
  const state = {x: integer(value.x, 0, cols), y: integer(value.y, 0, rows - 1), savedX: integer(value.savedX, 0, cols), savedOffsetY: integer(value.savedOffsetY, -10000, 10000),
    scrollTop: integer(value.scrollTop, 0, rows - 1), scrollBottom: integer(value.scrollBottom, 0, rows - 1),
    tabs: value.tabs.map(tab => integer(tab, 0, 499)), savedAttribute: readAttribute(value.savedAttribute), savedCharset: readCharset(value.savedCharset)};
  if (state.scrollTop > state.scrollBottom) throw Error('Invalid terminal checkpoint margins');
  return state;
}
function applyAttribute(target, value) { target.fg = value.fg; target.bg = value.bg; target.extended._ext = value.extended; target.extended._urlId = 0; }
function applyBuffer(target, value) {
  for (const key of ['x', 'y', 'savedX', 'scrollTop', 'scrollBottom']) target[key] = value[key];
  target.savedY = Math.max(0, target.ybase + value.savedOffsetY); target.savedCharset = value.savedCharset;
  target.tabs = Object.create(null); for (const tab of value.tabs) target.tabs[tab] = true;
  applyAttribute(target.savedCurAttrData, value.savedAttribute);
}
export function restoreTerminalState(terminal, value) {
  const core = xtermCore(terminal);
  if (value?.abi !== 'xterm-6.0.0/1' || value.cols !== terminal.cols || value.rows !== terminal.rows || core._inputHandler._parser.currentState !== 0) throw Error('Terminal checkpoint ABI or dimensions mismatch');
  // Validate the entire payload before mutating any engine state.
  const normal = readBuffer(value.normal, terminal.cols, terminal.rows), alternate = readBuffer(value.alternate, terminal.cols, terminal.rows);
  const attr = readAttribute(value.attribute), join = integer(value.joinState, -2147483648, 4294967295), level = integer(value.charset?.level, 0, 3);
  if (!Array.isArray(value.charset?.banks) || value.charset.banks.length !== 4) throw Error('Invalid terminal checkpoint charset banks');
  const banks = value.charset.banks.map(readCharset), active = readCharset(value.charset.active);
  applyBuffer(core._bufferService.buffers.normal, normal); applyBuffer(core._bufferService.buffers.alt, alternate);
  core._charsetService._charsets = banks; core._charsetService.glevel = level; core._charsetService.charset = active;
  applyAttribute(core._inputHandler._curAttrData, attr); core._inputHandler._parser.precedingJoinState = join;
}
