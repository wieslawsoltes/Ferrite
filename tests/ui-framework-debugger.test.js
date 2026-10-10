import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {UICompiler} from '../src/ui-framework/UICompiler.js';
import {UISession} from '../src/ui-framework/UISession.js';
import {createUIRuntime} from '../src/ui-framework/Runtime.js';
import {createDocument, elements} from './fixtures/ui-dom.js';

const file = 'src/app.ui.rs';
const source = `mod math;
fn app() -> ui::Node {
  let count = ui::use_state(0);
  view! { <div><button on:click={move || {
    let previous = ui::get(count);
    let next = math::bump(previous);
    ui::set(count, next);
  }}>Go</button><output>{ui::get(count)}</output></div> }
}`;
const helper = `pub fn bump(value: i64) -> i64 {
  let increment = 1_i64;
  value + increment
}`;
const line = (text, needle) => text.slice(0, text.indexOf(needle)).split('\n').length;
const artifact = UICompiler.compile(source, {file, files: {[file]: source, 'src/math.rs': helper}});
function fixture(t, backend = 'javascript', compiled = artifact) {
  const container = createDocument().createElement('main'), runtime = createUIRuntime();
  const session = new UISession(compiled, {runtime, backend}).mount(container);
  t.after(() => session.dispose());
  return {session, container, click: () => elements(container, 'button')[0].dispatchEvent(new Event('click')), value: () => elements(container, 'output')[0]?.textContent};
}
async function settled(session, predicate = () => session.debugger.status !== 'running') {
  const until = Date.now() + 5000;
  while (!predicate() && Date.now() < until) await delay(5);
  assert.ok(predicate(), JSON.stringify(session.inspectDebugger()));
}
for (const backend of ['javascript','mir','wasm']) {
  test(`${backend}: source breakpoints run to the requested helper line and resume without remounting`, async t => {
    const {session,click,value} = fixture(t,backend);
    session.armDebugger({breakpoints:[{file:'src/math.rs',line:3}],pauseOnEntry:false}); click();
    await settled(session);
    let debug = session.inspectDebugger(); assert.equal(debug.reason,'Breakpoint');
    assert.equal(debug.state.next.file,'src/math.rs'); assert.equal(debug.state.next.line,3);
    assert.equal(debug.state.frames.length,2); assert.equal(value(),'0');
    assert.ok(debug.state.frames.at(-1).locals.some(local=>local.name==='increment'&&local.value==='1'));
    const root=session.root; session.debug('continue'); await settled(session);
    assert.equal(value(),'1'); assert.equal(session.root,root); assert.equal(session.debugger.vm,null);
    assert.equal(session.inspectDebugger().status,'waiting');
    click(); await settled(session); assert.equal(session.inspectDebugger().reason,'Breakpoint');
    session.debug('stop'); assert.equal(value(),'1'); click(); assert.equal(value(),'2');
  });
  test(`${backend}: functional updater closures use the same inspectable and reversible MIR stack`, async t => {
    const src=`fn app() -> ui::Node { let count = ui::use_state(0);
      view! { <div><button on:click={move || ui::update(count, |n| {
        let result = n + 1;
        result
      })}>Go</button><output>{ui::get(count)}</output></div> } }`;
    const {session,click,value}=fixture(t,backend,UICompiler.compile(src,{file}));
    session.armDebugger({breakpoints:[{file,line:3}],pauseOnEntry:false});click();await settled(session);
    const debug=session.inspectDebugger();assert.equal(debug.reason,'Breakpoint');assert.equal(debug.state.frames.length,2);
    assert.ok(debug.state.frames.at(-1).locals.some(local=>local.name==='n'&&local.value==='0'));
    session.debug('step');assert.ok(session.inspectDebugger().state.history.available);
    session.debug('back');assert.equal(session.inspectDebugger().state.steps,debug.state.steps);
    session.setBreakpoints([]);session.debug('step-out');await settled(session);
    assert.equal(session.inspectDebugger().state.frames.length,1);assert.equal(value(),'0');
    session.debug('continue');await settled(session);assert.equal(value(),'1');assert.equal(session.handles.size,1);
  });
  test(`${backend}: source step over/out and terminal reverse state remain usable`, async t => {
    const {session,click,value}=fixture(t,backend);
    session.armDebugger({breakpoints:[{file,line:6}],pauseOnEntry:false});click();await settled(session);
    session.setBreakpoints([]);session.debug('step-over');await settled(session);
    assert.equal(session.inspectDebugger().state.next.file,file);assert.equal(session.inspectDebugger().state.next.line,7);
    session.debug('step-out');await settled(session);
    assert.equal(session.inspectDebugger().status,'completed');assert.ok(session.inspectDebugger().state.done);
    assert.equal(value(),'0');session.debug('back');assert.equal(session.inspectDebugger().state.done,false);
    session.debug('continue');await settled(session);assert.equal(value(),'1');
  });
}

test('live breakpoints are copied, deduplicated, validated and report nonexecutable locations', t => {
  const {session}=fixture(t);const points=[{file,line:6},{file,line:6},{file,line:999}];session.armDebugger({breakpoints:points});
  points[0].line=1;points.push({file,line:3});assert.deepEqual(session.inspectDebugger().breakpoints,[{file,line:6},{file,line:999}]);
  assert.equal(session.inspectDebugger().breakpointBindings[1].verified,false);
  for(const points of [null,[null],[{file,line:0}],[{file,line:1.5}],[{line:1}]])assert.throws(()=>session.setBreakpoints(points),/Invalid/);
  session.dispose();assert.throws(()=>session.armDebugger(),/disposed/);assert.throws(()=>session.debug('continue'),/disposed/);
});
test('queued clicks are drained after Continue and use freshly committed state', async t => {
  const {session,click,value}=fixture(t);session.armDebugger();click();click();click();
  assert.equal(session.inspectDebugger().queued,2);assert.equal(value(),'0');
  session.debug('continue');await settled(session,()=>session.debugger.queue.length===0&&session.debugger.vm===null&&value()==='3');
  assert.equal(session.inspectDebugger().status,'waiting');assert.equal(session.handles.size,1);
});
test('Stop discards queued events and uncommitted state; later events use the normal backend', async t => {
  const {session,click,value}=fixture(t);session.armDebugger();click();click();
  session.debug('step-out');await settled(session);assert.equal(value(),'0');
  session.debug('stop');await delay(15);assert.equal(value(),'0');assert.equal(session.inspectDebugger().queued,0);
  click();assert.equal(value(),'1');
});
test('long callbacks yield to the browser and are immediately pausable and stoppable', async t => {
  const src=`fn app() -> ui::Node { let count=ui::use_state(0);view! { <div><button on:click={move || { let mut n=0_i64; while n<10000 { n+=1; } ui::set(count,n); }}>Go</button><output>{ui::get(count)}</output></div> } }`;
  const {session,click,value}=fixture(t,'javascript',UICompiler.compile(src,{file,maxSteps:250000}));
  session.armDebugger();click();session.debug('continue');assert.equal(session.inspectDebugger().status,'running');
  assert.throws(()=>session.debug('step'),/Pause/);
  session.debug('pause');const steps=session.inspectDebugger().state.steps;await delay(20);assert.equal(session.inspectDebugger().state.steps,steps);
  session.debug('continue');assert.equal(session.inspectDebugger().status,'running');session.debug('stop');await delay(20);
  assert.equal(session.debugger.vm,null);assert.equal(value(),'0');assert.equal(session.inspectDebugger().status,'disarmed');
});
test('callback panics keep frames and reverse history; Continue cannot skip a failed instruction', t => {
  const src=`fn app()->ui::Node { view! { <button on:click={move || { let value=7_i64; if value == 7 { panic!("failed {}",value); } }}>Go</button> } }`;
  const {session,click}=fixture(t,'javascript',UICompiler.compile(src,{file}));session.armDebugger();click();
  assert.throws(()=>session.debug('continue'),/failed 7/);assert.equal(session.inspectDebugger().status,'error');assert.ok(session.inspectDebugger().state.frames.length);
  assert.throws(()=>session.debug('continue'),/Reverse/);session.debug('back');assert.equal(session.inspectDebugger().status,'paused');
  assert.throws(()=>session.debug('continue'),/failed 7/);session.debug('stop');assert.equal(session.inspectDebugger().error,null);
});
test('armed timer callbacks remain debuggable and pending ticks are coalesced', async t => {
  const src=`fn app()->ui::Node { let count=ui::use_state(0);ui::interval(5,move |delta:f64| { ui::set(count,ui::get(count)+1); });view! { <output>{ui::get(count)}</output> } }`;
  const {session}=fixture(t,'javascript',UICompiler.compile(src,{file}));session.armDebugger();
  await settled(session,()=>!!session.debugger.vm);assert.equal(session.inspectDebugger().event,'timer');assert.equal(session.inspectDebugger().status,'paused');
  await delay(30);assert.ok(session.inspectDebugger().queued<=1);session.debug('stop');
});
test('queued-event notifications retain the paused snapshot consumed by IDE inspectors',t=>{
  const {session,click}=fixture(t);const events=[];session.subscribe(event=>events.push(event));session.armDebugger();click();click();
  const event=events.find(event=>event.type==='debug-queued');assert.equal(event.status,'paused');assert.equal(event.armed,true);assert.equal(event.queued,1);assert.ok(event.state.frames.length);session.debug('stop');
});
