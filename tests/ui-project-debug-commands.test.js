import test from 'node:test';
import assert from 'node:assert/strict';
import {UICommandController} from '../src/ui/controllers/UICommandController.js';
import {IdeApplication} from '../src/ui/IdeApplication.js';
import {StudioTools} from '../src/ui/studio/StudioTools.js';

const file = 'src/app.ui.rs';
function fixture(t) {
  const calls = [], errors = [], model = {active:file, files:{[file]:'fn app()->ui::Node { view! { <div/> } }'}, revision:1, workspaceEpoch:1};
  const session = {generation:1, compiledGeneration:1, compiledBackend:'javascript', artifact:{}, snapshot:{debugger:{armed:false}}, backendSelect:{}, dock:{open:kind=>calls.push(['dock',kind])},
    preview:{ready:true, waitUntilReady:async()=>{}}, build:async()=>calls.push(['build']),
    debug:async(command,signal)=>{signal?.throwIfAborted();calls.push(['debug',command]);session.snapshot.debugger.armed=command!=='stop';},stopDebugging:()=>calls.push(['stop'])};
  const studio = {sourceOwners:new Map(),sessions:new Map([[file,session]]),isView:path=>path?.endsWith('.ui.rs'),session:()=>session,showSession:()=>calls.push(['show'])};
  const app = {model,studio,backend:'javascript',dock:{open:kind=>calls.push(['main-dock',kind])},status:()=>{},error:error=>errors.push(error)};
  const controller=new UICommandController(app);t.after(()=>controller.dispose());return {controller,session,app,model,calls,errors};
}
test('Debug attaches to an existing preview without recompiling or losing state',async t=>{
  const f=fixture(t);await f.controller.debug('continue');assert.deepEqual(f.calls.filter(c=>c[0]==='debug'),[['debug','arm']]);assert.ok(!f.calls.some(c=>c[0]==='build'));assert.equal(f.session.startQueued,false);assert.deepEqual(f.errors,[]);
  await f.controller.debug('continue');assert.deepEqual(f.calls.filter(c=>c[0]==='debug'),[['debug','arm'],['debug','continue']]);
});
test('Debug rebuilds stale or changed-backend previews before waiting for readiness',async t=>{
  for(const stale of ['artifact','backend','generation']){
    const f=fixture(t);if(stale==='artifact')f.session.artifact=null;else if(stale==='backend')f.app.backend='wasm';else f.session.generation++;
    await f.controller.run('debug',file);assert.equal(f.calls.filter(c=>c[0]==='build').length,1);assert.ok(f.calls.find(c=>c[1]==='arm'));assert.deepEqual(f.errors,[]);
  }
});
test('Stop while mounting cancels the launch and cannot arm on a late ready event',async t=>{
  const f=fixture(t);let ready;f.session.preview.waitUntilReady=()=>new Promise(resolve=>ready=resolve);const pending=f.controller.run('debug',file);
  f.controller.cancel();ready();await pending;assert.ok(!f.calls.some(c=>c[0]==='debug'));assert.equal(f.session.startQueued,false);assert.deepEqual(f.errors,[]);
});
test('replaced workspaces and switched view documents cannot be armed by an old launch',async t=>{
  for(const change of ['workspace','document']){
    const f=fixture(t);let ready;f.session.preview.waitUntilReady=()=>new Promise(resolve=>ready=resolve);const pending=f.controller.run('debug',file);
    if(change==='workspace')f.model.workspaceEpoch++;else {f.model.files['src/second.ui.rs']='';f.model.active='src/second.ui.rs';}
    ready();await pending;assert.ok(!f.calls.some(c=>c[0]==='debug'));assert.deepEqual(f.errors,[]);
  }
});
test('UI helper documents route to their owning session; ordinary Cargo sources do not',async t=>{
  const f=fixture(t);f.model.files['Cargo.toml']='';f.model.files['src/helper.rs']='';f.model.active='src/helper.rs';
  assert.equal(await f.controller.debug('step'),false);f.app.studio.sourceOwners.set('src/helper.rs',file);
  assert.equal(await f.controller.debug('step-out'),true);assert.deepEqual(f.calls,[['debug','step-out']]);await f.controller.debug('stop');assert.deepEqual(f.calls.at(-1),['stop']);
});
test('main IDE keyboard and toolbar dispatcher prefers UI and preserves ordinary MIR dispatch',async()=>{
  const calls=[],app={backend:'javascript',uiCommands:{debug:async command=>{calls.push(['ui',command]);return true;}},execution:{worker:{},command:command=>calls.push(['worker',command])},model:{breakpointList:[]},stop:()=>calls.push(['stop']),compile:async command=>calls.push(['compile',command]),error:error=>{throw error;}};
  await IdeApplication.prototype.debugCommand.call(app,'step-over');assert.deepEqual(calls,[['ui','step-over']]);
  app.uiCommands.debug=async()=>false;await IdeApplication.prototype.debugCommand.call(app,'step-out');assert.deepEqual(calls.at(-1),['worker','step-out']);
  app.execution.worker=null;await IdeApplication.prototype.debugCommand.call(app,'continue');assert.deepEqual(calls.at(-1),['compile','debug']);
});
function tools() {
  const requests=[],session={generation:1,model:{breakpointList:[{file,line:3}]},snapshot:{debugger:{armed:true,status:'paused',state:{steps:5}}},artifact:{},assertLive(){},assertSourcePreview(){},renderState(){},error(error){throw error;},interact:async()=>{},preview:{channel:'a',ready:true,request:async(command,values)=>{requests.push([command,values]);return {armed:true,command};}}};
  return {session,requests};
}
test('debug commands synchronize current breakpoints, while arm configures interaction before attachment',async()=>{
  const f=tools();await StudioTools.debug.call(f.session,'step-line');assert.deepEqual(f.requests.map(r=>r[0]),['debug.breakpoints','debug.step-line']);
  f.requests.length=0;f.session.interact=async()=>f.requests.push(['interact']);await StudioTools.debug.call(f.session,'arm');assert.deepEqual(f.requests.map(r=>r[0]),['interact','debug.arm']);assert.equal(f.requests[1][1].pauseOnEntry,false);
  f.session.model.breakpointList=[];await StudioTools.debug.call(f.session,'arm');assert.equal(f.requests.at(-1)[1].pauseOnEntry,true);
});
test('obsolete command replies do not overwrite replacement debugger state',async()=>{
  const f=tools();let reply;f.session.preview.request=()=>new Promise(resolve=>reply=resolve);const pending=StudioTools.debug.call(f.session,'pause');f.session.generation++;const state=f.session.snapshot.debugger;reply({status:'paused'});await pending;assert.equal(f.session.snapshot.debugger,state);
});
test('live breakpoint acknowledgements preserve a newer stop location and update binding metadata',async()=>{
  const f=tools();let reply;f.session.preview.request=()=>new Promise(resolve=>reply=resolve);StudioTools.syncBreakpoints.call(f.session);const current={steps:25};f.session.snapshot.debugger.state=current;
  const points=[{file,line:9}],bindings=[{file,line:9,verified:true}];reply({breakpoints:points,breakpointBindings:bindings,state:{steps:5}});await Promise.resolve();
  assert.equal(f.session.snapshot.debugger.state,current);assert.deepEqual(f.session.snapshot.debugger.breakpoints,points);assert.deepEqual(f.session.snapshot.debugger.breakpointBindings,bindings);
});
test('UI debugger Stop cancels an in-flight launch and normal UI launches detach CLI execution',async t=>{
  const f=fixture(t);let ready;f.app.execution={stop:()=>f.calls.push(['detach-cli'])};f.app.compiler={cancel:()=>f.calls.push(['cancel-cli-build'])};
  f.session.preview.waitUntilReady=()=>new Promise(resolve=>ready=resolve);const pending=f.controller.run('debug',file);
  await f.controller.debug('stop');ready();await pending;assert.ok(f.calls.find(c=>c[0]==='detach-cli'));assert.ok(f.calls.find(c=>c[0]==='cancel-cli-build'));assert.ok(f.calls.find(c=>c[0]==='stop'));assert.ok(!f.calls.some(c=>c[0]==='debug'));
});
