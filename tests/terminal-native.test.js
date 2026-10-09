import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {TerminalManager} from '../src/agent/terminal/TerminalManager.js';
import {TerminalScreen} from '../src/agent/terminal/TerminalScreen.js';
import {EventLog} from '../src/agent/core/EventLog.js';
const root = fileURLToPath(new URL('../', import.meta.url));
function manager(t, options = {}) { const m = new TerminalManager({path:async()=>root},new EventLog(),options); t.after(()=>m.dispose()); return m; }
const native = {skip:process.platform==='win32',timeout:15000};
const visible = async (m,id,contains) => { const result=await m.wait(id,{contains,timeoutMs:5000}); assert.ok(result.matched,JSON.stringify({contains,result,screen:await m.snapshot(id)})); return result; };

test('actual ncurses renders ACS/colors/Unicode and accepts keys, mouse, resize and normal-buffer restoration',native,async t=>{
  const m=manager(t), s=await m.start({executable:'python3',args:['-I','-u','tests/fixtures/terminal-curses.py'],cols:80,rows:24,owner:'test'});
  await visible(m,s.id,'Ready'); let snap=await m.snapshot(s.id,{cells:true});
  assert.equal(snap.buffer,'alternate'); assert.equal(snap.title,'Ferrite ncurses fixture'); assert.match(snap.lines[0],/^┌─+┐$/); assert.match(snap.text,/Unicode: 界é/);
  assert.equal(snap.cells[1][2].bold,true); assert.deepEqual(snap.cells[1][2].fg,{mode:'palette',value:6});
  await m.key(s.id,{key:'ArrowDown'}); await visible(m,s.id,'Selected: 2');
  await m.key(s.id,{key:'F1'}); await visible(m,s.id,'Event: HELP');
  await m.key(s.id,{key:'Ż'}); await m.key(s.id,{key:'界'}); await visible(m,s.id,'Input: Ż界');
  assert.equal((await m.snapshot(s.id)).modes.mouseEncoding,'sgr');
  await m.mouse(s.id,{type:'down',column:7,row:8}); await visible(m,s.id,'MOUSE 7,8');
  await m.mouse(s.id,{type:'up',column:7,row:8});
  await m.resize(s.id,97,31); await visible(m,s.id,'Size: 97x31');
  const state=await m.state(s.id), replica=new TerminalScreen(state.cols,state.rows); t.after(()=>replica.dispose()); await replica.write(state.ansi);
  assert.match(replica.text(),/Size: 97x31/); assert.equal(replica.snapshot().buffer,'alternate');
  await m.key(s.id,{key:'q'}); await m.get(s.id).exited;
  snap=await m.snapshot(s.id); assert.equal(snap.closed,true); assert.equal(snap.exitCode,0); assert.equal(snap.buffer,'normal'); assert.match(snap.text,/NORMAL BUFFER/); assert.match(snap.text,/CURSES_EXIT_OK/);
});
test('a headless PTY answers cursor reports without a browser or MCP reader',native,async t=>{
  const m=manager(t), code="import os,tty; tty.setraw(0); os.write(1,b'\\x1b[3;7H\\x1b[6n'); data=os.read(0,64); os.write(1,b'\\r\\nREPLY:'+data.hex().encode()+b'\\r\\n')";
  const s=await m.start({executable:'python3',args:['-I','-u','-c',code]}); await m.get(s.id).exited;
  assert.match((await m.snapshot(s.id)).text,/REPLY:1b5b333b3752/); assert.equal(m.read(s.id).exitCode,0);
});
test('resize acknowledgements are ordered with data and validate sizes',native,async t=>{
  const m=manager(t), s=await m.start();
  await m.resize(s.id,90,33); m.input(s.id,"stty size; printf '\\033[6n'; exit 0\r"); await m.get(s.id).exited;
  const result=m.read(s.id); assert.ok(result.events.some(e=>e.type==='resize'&&e.cols===90&&e.rows===33)); assert.match(result.events.map(e=>e.text??'').join(''),/33 90/);
  assert.throws(()=>m.resize(s.id,NaN,30),{code:'TERMINAL_SIZE'}); await assert.rejects(m.resize(s.id,80,24),{code:'TERMINAL_CLOSED'});
});
test('wait is literal, bounded, cancellation-safe and leaves no listeners',native,async t=>{
  const m=manager(t), s=await m.start(); m.input(s.id,"printf 'WAIT_READY\\n'\r"); await visible(m,s.id,'WAIT_READY'); const session=m.get(s.id), listeners=session.log.listeners.size;
  const controller=new AbortController(), cancelled=m.wait(s.id,{contains:'never-seen',timeoutMs:10000,signal:controller.signal}); controller.abort(); await assert.rejects(cancelled,{name:'AbortError'});
  assert.equal(session.log.listeners.size,listeners); assert.equal(session.waiters,0);
  const timeout=await m.wait(s.id,{contains:'[not a regex].*',timeoutMs:15}); assert.equal(timeout.timedOut,true); assert.equal(timeout.reason,'timeout');
  assert.equal(session.log.listeners.size,listeners);
  await assert.rejects(m.wait(s.id,{timeoutMs:30001}),{code:'TERMINAL_WAIT'});
  m.input(s.id,'exit 4\r'); const result=await m.wait(s.id,{until:'exit',timeoutMs:5000}); assert.equal(result.exitCode,4); assert.equal(result.matched,true);
});
test('screen recovery does not depend on retained replay escape boundaries',native,async t=>{
  const m=manager(t), s=await m.start(); m.get(s.id).log.limit=1;
  m.input(s.id,"printf '\\033[?1049h\\033[HRECOVER_ME'; sleep .1; printf '\\033[2;1HLAST_ROW'; sleep 2\r");
  await visible(m,s.id,'RECOVER_ME\nLAST_ROW'); const log=m.read(s.id); assert.equal(log.gap,true);
  const state=await m.state(s.id), replica=new TerminalScreen(state.cols,state.rows); t.after(()=>replica.dispose()); await replica.write(state.ansi);
  assert.match(replica.text(),/RECOVER_ME/); assert.match(replica.text(),/LAST_ROW/); assert.equal(state.cursor,m.read(s.id).cursor);
});
