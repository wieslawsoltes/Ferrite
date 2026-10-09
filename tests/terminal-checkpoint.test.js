import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalScreen} from '../src/agent/terminal/TerminalScreen.js';
import {TerminalFramer} from '../src/agent/terminal/TerminalFramer.js';
import {captureTerminalState, restoreTerminalState, xtermCore} from '../src/agent/terminal/XtermStateAdapter.js';
const screen = (t, cols = 30, rows = 8) => { const s = new TerminalScreen(cols, rows); t.after(() => s.dispose()); return s; };
const compare = (a, b) => { const expected = a.snapshot({cells:true}), actual = b.snapshot({cells:true}); for (const key of ['lines','cells','cursorPosition','buffer','modes']) assert.deepEqual(actual[key], expected[key], key); };

test('checkpoint continues scrolling margins, DECSC attributes, charset banks, tab stops and pending wrap', async t => {
  const cases = [
    ['top\r\n111\r\n222\r\n333\r\n444\r\n555\r\n666\r\nbottom\x1b[2;7r\x1b[7;1H', '\nNEW\x1b[2;1H\x1b[LINSERT\x1b[7;1H\nMORE'],
    ['normal\x1b[?1049h\x1b[3;4H\x1b[1;4;38;2;20;30;40m\x1b7\x1b[7;1H\x1b[0m', '\x1b8RESTORED\x1b[?1049lEND'],
    ['\x1b)0\x0eqq\x1b7\x0fABC', '\x1b8qq\x0fTEXT\x0eqq'],
    ['\x1b[3g\x1b[1;5H\x1bH\x1b[1;13H\x1bH\r', 'a\tb\tc'],
    ['123456789012345678901234567890', 'WRAP'],
    ['e', '\u0301'],
    ['\x1b[2;6r\x1b[?6h\x1b[3;4Htest', '\x1b[1;1HHOME\x1b[5;1H\nSCROLL']
  ];
  for (const [prefix, suffix] of cases) {
    const source = screen(t), replica = screen(t); await source.write(prefix);
    const protocol = JSON.parse(JSON.stringify(captureTerminalState(source.terminal)));
    await replica.write(source.serialize()); restoreTerminalState(replica.terminal, protocol); compare(source, replica);
    await source.write(suffix); await replica.write(suffix); compare(source, replica);
  }
});
test('checkpoint protocol validation is atomic and refuses ABI drift and prototype injection', async t => {
  const s = screen(t); await s.write('unchanged'); const protocol = captureTerminalState(s.terminal), before = s.snapshot({cells:true});
  assert.throws(()=>restoreTerminalState(s.terminal,{...protocol,abi:'unverified-version'}));
  assert.throws(()=>restoreTerminalState(s.terminal,{...protocol,charset:{...protocol.charset,active:JSON.parse('{"__proto__":"bad"}')}}));
  assert.throws(()=>restoreTerminalState(s.terminal,{...protocol,alternate:{...protocol.alternate,x:999}}));
  assert.deepEqual(s.snapshot({cells:true}),before); assert.equal({}.bad,undefined);
  await s.write('\x1b['); assert.throws(()=>captureTerminalState(s.terminal),/boundary/);
});
test('PTY framing uses actual xterm grammar and only emits complete parser boundaries', async t => {
  const streams = [
    'text\x1b[2;3HRED\x1b[31mRED\x1b[0m\x1b(0qq\x1b(B',
    '\x1b]2;Title\x1b\\visible\x1bP$qm\x1b\\done',
    '\x9b3;4HX\x9d2;title\x9cY\x90$qm\x9c',
    '\x1b]2;ignored\x18X\x1b[2;\x1b[3;4HY',
    '\x1b[1;\n2HZ\x1b_ignored\x1b\\end界é'
  ];
  for (const stream of streams) for (let split = 0; split <= stream.length; split++) {
    const target = new TerminalScreen(30,8), reference = new TerminalScreen(30,8), framer = new TerminalFramer(target.terminal);
    try {
      let emitted = '';
      for (const part of [stream.slice(0,split),stream.slice(split)]) {
        const packet = framer.push(part); emitted += packet; await target.write(packet);
        assert.equal(xtermCore(target.terminal)._inputHandler._parser.currentState,0);
      }
      assert.equal(emitted,stream); assert.equal(framer.pending,''); await reference.write(stream); compare(reference,target);
    } finally { target.dispose(); reference.dispose(); }
  }
});
test('unterminated controls are bounded and discarded without swallowing later ordinary text', async t => {
  const s = screen(t), framer = new TerminalFramer(s.terminal,{limit:32});
  assert.equal(framer.push('safe\x1b]2;'),'safe');
  for (let n=0;n<100;n++) { assert.equal(framer.push('x'.repeat(1000)),''); assert.ok(framer.pending.length<=32); }
  assert.equal(framer.discarded,1); assert.equal(framer.push('\x1b\\recovered'),'recovered'); assert.equal(framer.state,0);
  assert.equal(framer.push('\x1b]2;'+'x'.repeat(29)+'\x07after'),'after'); assert.equal(framer.discarded,2);
  assert.equal(framer.push('\x1b[3;'),''); assert.equal(framer.push('4HX'),'\x1b[3;4HX');
});
test('soft reset updates reported cursor appearance', async t => {
  const s=screen(t); await s.write('\x1b[?25l\x1b[6 q'); await s.write('\x1b[!p');
  assert.equal(s.snapshot().cursorPosition.visible,true); assert.equal(s.modes().cursorStyle,0);
});

test('resized alternate snapshots do not erase the last column using hidden backing cells', async t => {
  const source = screen(t, 40, 8), replica = screen(t, 30, 10);
  await source.write('\x1b[?1049h\x1b[37;40mOLD');
  source.resize(30, 10);
  await source.write('\x1b[2J\x1b[H' +
    Array.from({length: 10}, (_, row) => `│${String(row).padEnd(28, ' ')}│`).join('\r\n'));
  const before = source.snapshot({cells: true});
  const physicalLength = source.terminal.buffer.active.getLine(0).length;
  assert.ok(physicalLength > source.terminal.cols, 'upstream intentionally retains alternate backing width');
  await replica.write(source.serialize());
  restoreTerminalState(replica.terminal, captureTerminalState(source.terminal));
  compare(source, replica);
  assert.deepEqual(source.snapshot({cells: true}), before);
  assert.equal(source.terminal.buffer.active.getLine(0).length, physicalLength);
});
