import test from 'node:test';
import assert from 'node:assert/strict';
import {Terminal} from '../src/vendor/xterm/headless.mjs';
import {TerminalScreen} from '../src/agent/terminal/TerminalScreen.js';
import {TerminalInput} from '../src/agent/terminal/TerminalInput.js';
import {installTerminalPolicy} from '../src/agent/terminal/TerminalProtocol.js';
const decode = bytes => new TextDecoder().decode(bytes);
const screen = (t, cols = 40, rows = 8, options) => { const s = new TerminalScreen(cols, rows, options); t.after(() => s.dispose()); return s; };

test('upstream parser handles every boundary of ncurses controls, ACS and Unicode', async t => {
  const stream = '\x1b[?1049h\x1b[H\x1b(0lqqk\r\nx  x\r\nmqqj\x1b(B\x1b[5;2H\x1b[38;2;12;34;56m界e\u0301';
  const reference = screen(t); await reference.write(stream); const expected = reference.snapshot({cells: true});
  assert.equal(expected.lines[0], '┌──┐'); assert.equal(expected.lines[2], '└──┘'); assert.equal(expected.lines[4], ' 界é');
  assert.equal(expected.cells[4][1].width, 2); assert.equal(expected.cells[4][2].width, 0); assert.equal(expected.cells[4][3].text, 'é');
  assert.deepEqual(expected.cells[4][1].fg, {mode: 'rgb', value: 0x0c2238});
  for (let split = 0; split <= stream.length; split++) {
    const s = new TerminalScreen(40, 8);
    try { await s.write(stream.slice(0, split)); await s.write(stream.slice(split)); assert.deepEqual(s.snapshot({cells: true}), expected, 'split ' + split); }
    finally { s.dispose(); }
  }
});
test('alternate buffer and cursor restore survive ANSI snapshot replication', async t => {
  const s = screen(t), replica = screen(t);
  await s.write('normal\r\nretained\x1b[?1049h\x1b[2J\x1b[3;4H\x1b[1;4;38;5;202mTUI\x1b[?25l\x1b[?1006h\x1b[?1002h\x1b[?2004h');
  await replica.write(s.serialize());
  for (const key of ['lines', 'cursorPosition', 'modes', 'buffer']) assert.deepEqual(replica.snapshot()[key], s.snapshot()[key], key);
  await s.write('\x1b[?1049l'); await replica.write('\x1b[?1049l');
  assert.equal(replica.text(), s.text()); assert.match(s.text(), /normal\nretained/);
});
test('cursor reports, primary/secondary attributes and DECRQSS come from the authority only', async t => {
  const replies = [], s = screen(t, 40, 8, {onReply: value => replies.push(value)});
  const term = new Terminal({cols: 40, rows: 8, allowProposedApi: true}), policy = installTerminalPolicy(term, {replica: true}), duplicates = [];
  term.onData(value => duplicates.push(value)); t.after(() => { policy.dispose(); term.dispose(); });
  const stream = '\x1b[3;7H\x1b[6n\x1b[5n\x1b[c\x1b[>c\x1bP$qm\x1b\\\x1b[?25$p\x1b]10;?\x07';
  await s.write(stream); await new Promise(resolve => term.write(stream, resolve));
  assert.ok(replies.includes('\x1b[3;7R')); assert.ok(replies.includes('\x1b[0n')); assert.ok(replies.length >= 6); assert.deepEqual(duplicates, []);
});
test('untrusted OSC clipboard and hyperlink data are blocked; title is bounded data', async t => {
  const replies = [], s = screen(t, 40, 8, {onReply: text => replies.push(text)});
  await s.write('\x1b]52;c;?\x07\x1b]52;c;c2VjcmV0\x07\x1b]8;;https://invalid.example\x1b\\safe\x1b]8;;\x1b\\\x1b]2;' + 't'.repeat(600) + '\x07');
  assert.deepEqual(replies, []); assert.equal(s.title.length, 512); assert.equal(s.snapshot().lines[0], 'safe');
});
test('scroll regions, insert/delete lines, erasure and cursor styling render correctly', async t => {
  const s = screen(t, 12, 5);
  await s.write('top\r\n111\r\n222\r\n333\r\nbottom\x1b[2;4r\x1b[4;1H\nNEW');
  assert.deepEqual(s.snapshot().lines, ['top','222','333','NEW','bottom']);
  await s.write('\x1b[2;1H\x1b[Labc\x1b[2 q'); assert.deepEqual(s.snapshot().lines, ['top','abc','222','333','bottom']);
  await s.write('\x1b[M\x1b[2K'); assert.deepEqual(s.snapshot().lines, ['top','','333','','bottom']); assert.equal(s.modes().cursorStyle, 2);
});
test('bounded scrollback, resize and cell snapshot limits', async t => {
  const s = screen(t, 20, 4, {scrollback: 3}); for (let i = 0; i < 20; i++) await s.write('line' + i + '\r\n');
  assert.equal(s.snapshot().historyLines, 3); s.resize(10, 3); assert.equal(s.snapshot().cols, 10); assert.equal(s.snapshot().rows, 3);
  assert.throws(() => s.snapshot({startRow: 3}), {code: 'TERMINAL_RANGE'});
  const large = screen(t, 500, 200); assert.throws(() => large.snapshot({cells: true}), {code: 'TERMINAL_RANGE'}); assert.equal(large.snapshot({cells: true, rowCount: 2}).cells.length, 2);
});
test('mode-aware keys, function keys, keypad, modifiers and control bytes', () => {
  assert.equal(decode(TerminalInput.key({key:'ArrowUp'})), '\x1b[A');
  assert.equal(decode(TerminalInput.key({key:'ArrowUp'}, {applicationCursorKeysMode:true})), '\x1bOA');
  assert.equal(decode(TerminalInput.key({key:'ArrowLeft',ctrl:true,shift:true,count:2})), '\x1b[1;6D\x1b[1;6D');
  assert.equal(decode(TerminalInput.key({key:'F1'})), '\x1bOP'); assert.equal(decode(TerminalInput.key({key:'F12',alt:true})), '\x1b[24;3~');
  assert.equal(decode(TerminalInput.key({key:'Numpad1'}, {applicationKeypadMode:true})), '\x1bOq');
  assert.equal(decode(TerminalInput.key({key:'c',ctrl:true})), '\x03'); assert.equal(decode(TerminalInput.key({key:'Space',ctrl:true})), '\0');
  assert.equal(decode(TerminalInput.key({key:'界'})), '界'); assert.throws(() => TerminalInput.key({key:'constructor'}), {code:'TERMINAL_INPUT'});
  assert.throws(() => TerminalInput.key({key:'a',count:101}), {code:'TERMINAL_INPUT'});
});
test('paste normalizes EOL, honors bracketed mode and cannot inject its terminator', () => {
  assert.equal(decode(TerminalInput.paste('a\r\nb\nc')), 'a\rb\rc');
  assert.equal(decode(TerminalInput.paste('a\x1b[201~b', {bracketedPasteMode:true})), '\x1b[200~a[201~b\x1b[201~');
  assert.throws(() => TerminalInput.paste('界'.repeat(30000)), {code:'TERMINAL_INPUT'});
});
test('SGR mouse, legacy byte coordinates, movement filtering and bounds', () => {
  const event = {column:120,row:8,type:'down',button:'left'}, modes = {mouseTrackingMode:'vt200',mouseEncoding:'sgr'};
  assert.equal(decode(TerminalInput.mouse(event,modes,200,30)), '\x1b[<0;120;8M');
  assert.equal(decode(TerminalInput.mouse({...event,type:'up'},modes,200,30)), '\x1b[<0;120;8m');
  assert.equal(decode(TerminalInput.mouse({...event,type:'wheel-down',ctrl:true},modes,200,30)), '\x1b[<81;120;8M');
  assert.deepEqual([...TerminalInput.mouse(event,{mouseTrackingMode:'vt200'},200,30)], [27,91,77,32,152,40]);
  assert.equal(TerminalInput.mouse({...event,type:'move',button:'none'},modes,200,30).length,0);
  assert.equal(TerminalInput.mouse(event,{mouseTrackingMode:'none'},200,30).length,0);
  assert.throws(() => TerminalInput.mouse({...event,column:0},modes,200,30),{code:'TERMINAL_INPUT'});
});
