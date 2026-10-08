import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {RepositoryPolicy as P} from '../src/native/repository/RepositoryPolicy.js';
import {RepositorySession} from '../src/native/repository/RepositorySession.js';
import {RepositoryManager} from '../src/native/repository/RepositoryManager.js';
import {BuildJobBudget} from '../src/native/BuildJobBudget.js';
import {ProcessRunner} from '../src/native/ProcessRunner.js';
import {CargoBridgeServer} from '../src/native/CargoBridgeServer.js';
import {NativeCargoClient} from '../src/ui/services/NativeCargoClient.js';
import {CargoDependencySpec} from '../src/cargo/CargoDependencySpec.js';
import {CargoOptions} from '../src/cargo/CargoOptions.js';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {RepositoryController} from '../src/ui/controllers/RepositoryController.js';

const files = {'Cargo.toml':'[package]\nname="app"\nversion="0.1.0"\nedition="2021"\n', 'src/main.rs':'fn main() { println!("hello"); }'};
async function directory(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ferrite-repository-test-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  for (const [path, content] of Object.entries({...files, ...extra})) { await mkdir(join(root,path,'..'), {recursive:true}); await writeFile(join(root,path),content); }
  return root;
}
const native = new ProcessRunner();
const metadataProcess = {async run(executable, args, options) {
  if (executable === 'cargo') return {exitCode:0, stdout:JSON.stringify({packages:[],workspace_members:[]}), stderr:''};
  return native.run(executable,args,options);
}};
const fakeFactory = ({project}) => ({async run(snapshot, command, options) {
  await project.update(snapshot); options.signal?.throwIfAborted();
  await writeFile(join(project.root,'Cargo.lock'),'version = 4\n');
  return {exitCode:0,stdout:'hello\n',stderr:'',artifacts:[{fresh:false}],command,jobs:options.jobs,elapsedMs:1};
}, async dispose(){}});

test('repository URL policy accepts HTTPS/SSH and rejects credentials, transport helpers and invalid refs', () => {
  assert.equal(P.remote('git@example.org:team/app.git'), 'ssh://git@example.org/team/app.git');
  assert.equal(P.remote('https://example.org/team/app.git'), 'https://example.org/team/app.git');
  for (const url of ['file:///tmp/a','ext::sh -c x','https://u:p@example.org/a','https://example.org/a?token=x','--help','https://example.org/']) assert.throws(()=>P.remote(url));
  for (const ref of ['--help','foo..bar','x.lock','refs/heads/']) assert.throws(()=>P.ref(ref));
  assert.equal(P.ref('refs/heads/feature/parsing'),'refs/heads/feature/parsing');
});
test('local root authorization resolves symlinks without prefix-confusion access', async t => {
  const root = await directory(t), other = await directory(t);
  assert.equal(await P.local(root,[root]), root);
  await assert.rejects(()=>P.local(other,[root]), /not authorized/);
  await symlink(other,join(root,'outside'));
  await assert.rejects(()=>P.local(join(root,'outside'),[root]), /not authorized/);
  await assert.rejects(()=>P.target(root,'outside/Cargo.toml'), /symlink/);
  assert(!P.contains(root, root + '-other')); assert.throws(()=>P.path('src/../Cargo.toml'));
});
test('editable projection preserves binary assets, secrets, caches and omitted files on disk', async t => {
  const root = await directory(t, {'assets/data.bin':Buffer.from([0,1,255]),'.env':'secret=token','target/cache.bin':Buffer.from([1,2]),'README.md':'hello'});
  const session = new RepositorySession({root,source:root}); const snapshot = await session.refresh();
  assert.equal(snapshot.files['README.md'],'hello'); assert(!snapshot.files['assets/data.bin']); assert(!snapshot.files['.env']);
  assert(snapshot.omitted.some(o=>o.path==='assets/data.bin'));
  await session.update({files:{...snapshot.files,'src/main.rs':'fn main() {}'}});
  assert.deepEqual(await readFile(join(root,'assets/data.bin')),Buffer.from([0,1,255]));
  assert.equal(await readFile(join(root,'.env'),'utf8'),'secret=token');
  await session.dispose(); await access(root); // Local directories are never owned/deleted.
});
test('all editor changes are checked for disk conflicts before any source write', async t => {
  const root=await directory(t,{'other.rs':'old'}), session=new RepositorySession({root,source:root}); const snapshot=await session.refresh();
  await writeFile(join(root,'other.rs'),'external');
  await assert.rejects(()=>session.update({files:{...snapshot.files,'src/main.rs':'fn main() {}','other.rs':'IDE'}}),/conflict/);
  assert.equal(await readFile(join(root,'src/main.rs'),'utf8'),files['src/main.rs']);
  assert.equal(await readFile(join(root,'other.rs'),'utf8'),'external');
});
test('new paths cannot overwrite unseen assets and deletions only touch projected files', async t => {
  const root=await directory(t,{'asset.bin':Buffer.from([0,255]),'old.rs':'old'}),session=new RepositorySession({root,source:root});const snapshot=await session.refresh();
  await assert.rejects(()=>session.update({files:{...snapshot.files,'asset.bin':'overwrite'}}),/conflict/);
  const changed={...snapshot.files,'new.rs':'new'};delete changed['old.rs'];await session.update({files:changed});
  await assert.rejects(()=>access(join(root,'old.rs')));assert.equal(await readFile(join(root,'new.rs'),'utf8'),'new');
  assert.deepEqual(await readFile(join(root,'asset.bin')),Buffer.from([0,255]));
});
test('UTF-8 BOM source survives projection and conflict-checked editing', async t => {
  const root=await directory(t,{'bom.rs':'\ufeff// crab 🦀'}),session=new RepositorySession({root,source:root});const snapshot=await session.refresh();
  assert.equal(snapshot.files['bom.rs'],'\ufeff// crab 🦀');
  await session.update({files:{...snapshot.files,'bom.rs':'\ufeff// café'}});
  assert.equal(await readFile(join(root,'bom.rs'),'utf8'),'\ufeff// café');
});
test('job budget admits independent work in parallel, bounds usage and releases idempotently', async () => {
  const budget=new BuildJobBudget(4),a=await budget.acquire(2),b=await budget.acquire(2);assert.equal(budget.used,4);
  let started=false;const pending=budget.acquire(1).then(value=>{started=true;return value;});await delay(5);assert(!started);
  a.release();const c=await pending;assert.equal(budget.used,3);a.release();assert.equal(budget.used,3);b.release();c.release();assert.equal(budget.used,0);
  assert.throws(()=>budget.jobs(0));assert.throws(()=>budget.jobs(5));assert.equal(budget.jobs('auto'),4);
});
test('queued cancellation removes only its own request and preserves FIFO admission',async()=>{
  const budget=new BuildJobBudget(2),a=await budget.acquire(2),abort=new AbortController();
  const cancelled=budget.acquire(2,abort.signal);const later=budget.acquire(1);abort.abort();await assert.rejects(cancelled);a.release();const b=await later;b.release();assert.equal(budget.used,0);
});
test('repository manager requires trust, supports plain Cargo roots, keeps sessions and rejects stale versions',async t=>{
  const root=await directory(t),manager=new RepositoryManager({allowedRoots:[root],jobs:2,processRunner:metadataProcess,runnerFactory:fakeFactory});t.after(()=>manager.dispose());
  await assert.rejects(()=>manager.open({kind:'local',path:root}),/trust/);
  const session=await manager.open({kind:'local',path:root,trust:true});assert.equal(session.owned,false);
  const reopened=await manager.open({kind:'local',path:root,trust:true});assert.equal(reopened.id,session.id);assert(reopened.version>session.version);
  await assert.rejects(()=>manager.run({...session,command:'run',jobs:2}),/Stale/);
  const result=await manager.run({...reopened,command:'run',jobs:2});assert.equal(result.stdout,'hello\n');assert.equal(result.repository.files['Cargo.lock'],'version = 4\n');assert.equal(result.buildSummary.jobs,2);
  await assert.rejects(()=>manager.run({...session,command:'check'}),/Stale/);
  await manager.close(session.id);await access(root);
});
test('different repositories run concurrently but a single checkout cannot be synchronized twice',async t=>{
  const root=await directory(t),other=await directory(t);let active=0,peak=0;
  const manager=new RepositoryManager({allowedRoots:[root,other],jobs:2,processRunner:metadataProcess,runnerFactory:({project})=>({async run(snapshot){await project.update(snapshot);active++;peak=Math.max(peak,active);await delay(50);active--;return {exitCode:0,stdout:'',stderr:'',artifacts:[],elapsedMs:50};},async dispose(){}})});t.after(()=>manager.dispose());
  const a=await manager.open({kind:'local',path:root,trust:true}),b=await manager.open({kind:'local',path:other,trust:true});
  const one=manager.run({...a,command:'build',jobs:1});await assert.rejects(()=>manager.run({...a,command:'build',jobs:1}),/running/);
  await Promise.all([one,manager.run({...b,command:'build',jobs:1})]);assert.equal(peak,2);assert.equal(manager.budget.used,0);
});
test('clone invocation is shell-free, pins commits and only enables submodules explicitly',async t=>{
  const calls=[];let checkout;
  const runner={async run(executable,args,options){calls.push({executable,args});
    if(args.includes('clone')){checkout=args.at(-1);await mkdir(join(checkout,'src'),{recursive:true});for(const [p,s] of Object.entries(files))await writeFile(join(checkout,p),s);}
    return {exitCode:0,stderr:'',stdout:executable==='cargo'?JSON.stringify({packages:[],workspace_members:[]}):args.includes('rev-parse')?'a'.repeat(40)+'\n':''};
  }};
  const manager=new RepositoryManager({processRunner:runner,runnerFactory:fakeFactory});t.after(()=>manager.dispose());
  const session=await manager.open({kind:'remote',url:'https://example.org/org/app.git',ref:'v1',trust:true});
  assert.equal(session.head,'a'.repeat(40));assert(calls.find(c=>c.args.includes('--no-recurse-submodules')));
  assert(calls.find(c=>c.args.includes('fetch')&&c.args.includes('v1')));assert(!calls.find(c=>c.args.includes('submodule')));
  assert(calls.filter(c=>c.executable==='git').every(c=>c.args.includes('protocol.file.allow=never')));
  await manager.close(session.id);await assert.rejects(()=>access(checkout));
});
test('authenticated repository routes reject untrusted origins and stream actual session operations',async t=>{
  const root=await directory(t),bridge=new CargoBridgeServer({repositories:{allowedRoots:[root],jobs:2,processRunner:metadataProcess,runnerFactory:fakeFactory}});
  const connection=await bridge.listen();t.after(()=>bridge.close());
  const denied=await fetch(connection.url+'/v1/repository/open',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
  const invalid=await fetch(connection.url+'/v1/repository/open',{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:'null'});assert.equal(invalid.status,400);
  const client=new NativeCargoClient();await client.connect(connection.url,connection.token);const events=[];
  const session=await client.repository('open',{kind:'local',path:root,trust:true},event=>events.push(event));
  assert(events.some(e=>e.type==='started'));const result=await client.repository('run',{...session,command:'run',jobs:1});assert.equal(result.stdout,'hello\n');
  await client.repository('close',{id:session.id});assert.equal(client.active,null);
});
test('native stdin is a bounded real pipe, not an emulated terminal',async()=>{
  let write;const processRunner=new ProcessRunner();
  const pending=processRunner.run(process.execPath,['-e','process.stdin.once("data",data=>{process.stdout.write(data);process.exit(0);});'],{onInput:fn=>write=fn});
  write('café 🦀\n');const result=await pending;assert.equal(result.stdout,'café 🦀\n');assert.equal(result.exitCode,0);
});
test('Cargo dependency builder distinguishes registry, Git revision and local path without shell quoting',()=>{
  assert.deepEqual(CargoDependencySpec.arguments({name:'serde',version:'1',features:['derive']}),['--features','derive','serde@1']);
  assert.deepEqual(CargoDependencySpec.arguments({name:'math',source:'path',path:'../math lib'}),['--path','../math lib','math']);
  assert.deepEqual(CargoDependencySpec.arguments({name:'foo',source:'git',git:'https://example.org/foo',rev:'abc'}),['--git','https://example.org/foo','--rev','abc','foo']);
  assert.throws(()=>CargoDependencySpec.arguments({name:'--config'}));assert.throws(()=>CargoDependencySpec.arguments({name:'a',source:'git',git:'file:///tmp/a'}));
  assert.deepEqual(CargoDependencySpec.arguments({name:'serde',kind:'dev'},true),['--dev','serde']);
});
test('run target and program argv remain selected when workspace/all-target build checkboxes are set',()=>{
  const args=CargoOptions.arguments('run',{workspace:true,allTargets:true,package:'app',target:'demo',targetKind:'example',programArgs:['a b','--help']});
  assert.deepEqual(args,['--package','app','--example','demo','--','a b','--help']);
  assert.deepEqual(CargoOptions.arguments('build',{workspace:true,allTargets:true,keepGoing:true,profile:'release',targetTriple:'wasm32-unknown-unknown'}),['--workspace','--all-targets','--target','wasm32-unknown-unknown','--keep-going','--profile','release']);
});
test('repository reconciliation preserves newer editor edits and refuses a conflicting next build',()=>{
  const model=new WorkspaceModel(files),controller=new RepositoryController(model,{});controller.load({id:'r',version:1,files});
  const submitted={...model.files};model.update('src/main.rs','newer editor');
  controller.reconcile({id:'r',version:2,files:{...submitted,'Cargo.lock':'v4'}},submitted);
  assert.equal(model.files['src/main.rs'],'newer editor');assert.equal(model.files['Cargo.lock'],'v4');assert(!controller.needsReload);
  assert.throws(()=>controller.reconcile({id:'r',version:3,files:{...submitted,'src/main.rs':'native fmt'}},submitted),/Concurrent/);assert.equal(model.files['src/main.rs'],'newer editor');assert(controller.needsReload);
  model.replace(files);assert.equal(controller.session,null);assert(!JSON.stringify(model.snapshot()).includes('root'));
});

test('native diagnostics never map external crate filenames to an unrelated editor source suffix',async()=>{
  const {NativeDiagnosticMapper}=await import('../src/ui/services/NativeDiagnosticMapper.js');
  const diagnostic=file=>({message:'error',spans:[{file,primary:true,byteStart:0,byteEnd:2}]});
  const projected={'src/lib.rs':'fn test(){}'};
  assert.equal(NativeDiagnosticMapper.map(diagnostic('/cargo/registry/pkg/src/lib.rs'),projected,{root:'/work/app'}).span,null);
  assert.equal(NativeDiagnosticMapper.map(diagnostic('/work/application/src/lib.rs'),projected,{root:'/work/app'}).span,null);
  assert.equal(NativeDiagnosticMapper.map(diagnostic('/work/app/src/lib.rs'),projected,{root:'/work/app'}).span.file,'src/lib.rs');
  assert.equal(NativeDiagnosticMapper.map(diagnostic('../sibling/src/lib.rs'),projected,{root:'/work/app'}).span,null);
});
test('repository language project borrows binary-complete checkout without changing disk or owning it',async t=>{
  const {RepositoryLanguageProject}=await import('../src/native/repository/RepositoryLanguageProject.js');
  const root=await directory(t),session=new RepositorySession({root,source:root}),overlay=new RepositoryLanguageProject(session);
  await overlay.update({files:{...files,'src/main.rs':'unsaved'}});assert.equal(await readFile(join(root,'src/main.rs'),'utf8'),files['src/main.rs']);
  await overlay.dispose();await access(root);assert.equal(overlay.previous.size,0);
});

test('Cargo reports are bounded, confined, and never reuse an earlier build report',async t=>{
  const {CargoTimingReport}=await import('../src/native/repository/CargoTimingReport.js');
  const root=await directory(t), session={root};
  assert.match((await CargoTimingReport.read(session)).omitted,/did not emit/);
  const path=join(root,'target/cargo-timings/cargo-timing.html');await mkdir(join(path,'..'),{recursive:true});await writeFile(path,'<p>Build one</p>');
  const fingerprint=await CargoTimingReport.fingerprint(session);assert.equal((await CargoTimingReport.read(session,null)).html,'<p>Build one</p>');
  assert.match((await CargoTimingReport.read(session,fingerprint)).omitted,/previous/);
  await writeFile(path,'<p>Build two</p>');assert.equal((await CargoTimingReport.read(session,fingerprint)).html,'<p>Build two</p>');
  assert.match((await CargoTimingReport.read({root,metadata:{target_directory:root+'-outside'}})).omitted,/outside/);
});
test('repository handles can be listed and resumed after detaching without deleting local files',async t=>{
  const root=await directory(t);const manager=new RepositoryManager({allowedRoots:[root],processRunner:metadataProcess,runnerFactory:fakeFactory});
  t.after(()=>manager.dispose());const opened=await manager.open({kind:'local',path:root,trust:true});
  const list=await manager.list();assert.equal(list.length,1);assert.equal(list[0].id,opened.id);assert(!('files' in list[0]));
  const resumed=await manager.refresh({id:opened.id});assert(resumed.version>opened.version);
  await manager.close(opened.id);assert.equal((await manager.list()).length,0);await access(root);
});
test('native stdin can explicitly close for programs reading to EOF',async()=>{
  const process=new ProcessRunner();const result=await process.run(globalThis.process.execPath,['-e',"let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(s));"],{onInput:write=>{write('🦀 EOF');write(null);}});
  assert.equal(result.exitCode,0);assert.equal(result.stdout,'🦀 EOF');
});
test('native metadata hides build-script executables and keeps distinct target kinds',async()=>{
  const {NativeCargoMetadata}=await import('../src/cargo/NativeCargoMetadata.js');
  const plan=NativeCargoMetadata.plan({metadata:{workspace_members:['p'],packages:[{id:'p',name:'app',targets:[{kind:['custom-build'],name:'build-script-build'},{kind:['bin'],name:'app'},{kind:['example'],name:'app'}]}]}},{target:'app',targetKind:'example'});
  assert.equal(plan.packages[0].targets.length,2);assert.equal(plan.target.kind,'example');
});

test('Cargo JSON streaming distinguishes build records from subsequent application JSON and prompts',async()=>{
  const {CargoLogStream}=await import('../src/native/CargoLogStream.js');const events=[];const logs=new CargoLogStream(e=>events.push(e),true);
  const build=JSON.stringify({reason:'compiler-artifact',fresh:false,target:{name:'my-crate'}})+'\n'+JSON.stringify({reason:'build-finished',success:true})+'\n';
  for(const char of build)logs.accept({kind:'stdout',text:char});
  const application='{"reason":"compiler-artifact","application":true}\nInput: ';
  logs.accept({kind:'stdout',text:application});logs.finish();
  assert.equal(events.filter(e=>e.kind==='artifact').length,1);assert.equal(events.at(-1).text,application);assert.equal(logs.programOutput,application);
  assert(!events.map(e=>e.text).join('').includes('"fresh"'));
});

test('application JSON after build-finished cannot fabricate Cargo artifacts or diagnostics',async()=>{
  const {CargoOutputParser}=await import('../src/native/CargoOutputParser.js');
  const raw=JSON.stringify({reason:'build-finished',success:true})+'\n'+JSON.stringify({reason:'compiler-message',message:{message:'user JSON',spans:[]}})+'\n'+JSON.stringify({reason:'compiler-artifact',executable:'/not-a-build-artifact'});
  const result=CargoOutputParser.parse(raw);assert.deepEqual(result.artifacts,[]);assert.deepEqual(result.diagnostics,[]);
});

test('nested manifests build from their directory, honoring nested Cargo configuration and toolchains',async t=>{
  const {NativeCargoRunner}=await import('../src/native/NativeCargoRunner.js');
  const root=await directory(t,{'nested/Cargo.toml':'[package]\nname="nested"\nversion="0.1.0"\n','nested/src/main.rs':'fn main(){}'});
  const session=new RepositorySession({root,source:root,manifest:'nested/Cargo.toml'});const snapshot=await session.refresh();
  const runner=new NativeCargoRunner({project:session});let call;
  runner.process={async run(executable,args,options){call={executable,args,options};return {exitCode:0,stdout:'',stderr:''};}};
  const result=await runner.run({files:snapshot.files},'run',{manifest:session.manifest,jobs:2,args:['--','--jobs','7']});
  assert.equal(call.options.cwd,join(root,'nested'));assert.equal(call.args[call.args.indexOf('--manifest-path')+1],join(root,'nested/Cargo.toml'));
  assert.equal(result.workingDirectory,join(root,'nested'));assert.equal(result.sourceRoot,root);
  assert.deepEqual(call.args.slice(-3),['--','--jobs','7']);
  await assert.rejects(()=>runner.run({files:snapshot.files},'build',{manifest:session.manifest,args:['--manifest-path','other.toml']}),/manifest control/);
  await runner.dispose();await access(root);
});
test('nested manifest diagnostics resolve relative locations against cwd but stay inside the selected repository',async()=>{
  const {NativeDiagnosticMapper:M}=await import('../src/ui/services/NativeDiagnosticMapper.js');
  const files={'app/src/main.rs':'🦀hello','lib/src/lib.rs':'abc'};
  const map=file=>M.map({spans:[{primary:true,file,byteStart:4,byteEnd:5}]},files,{root:'/repo',cwd:'/repo/app'});
  assert.equal(map('src/main.rs').span.file,'app/src/main.rs');assert.equal(map('./src/main.rs').span.start,2);
  assert.equal(map('../lib/src/lib.rs').span.file,'lib/src/lib.rs');assert(map('../../outside/src/main.rs').external);
  assert(map('/different/app/src/main.rs').external);
});

test('failed process startup after source synchronization invalidates stale client revisions until reload',async t=>{
  const root=await directory(t);const manager=new RepositoryManager({allowedRoots:[root],processRunner:metadataProcess,runnerFactory:({project})=>({async run(snapshot){await project.update(snapshot);throw Error('spawn failed');},async dispose(){}})});
  t.after(()=>manager.dispose());const opened=await manager.open({kind:'local',path:root,trust:true});
  await assert.rejects(()=>manager.run({...opened,command:'build',files:{...opened.files,'src/main.rs':'fn main(){println!("saved before failure");}'}}),/spawn failed/);
  assert(manager.get(opened.id).needsRefresh);assert(manager.get(opened.id).version>opened.version);
  await assert.rejects(()=>manager.run({...opened,command:'build'}),/Stale/);
  await assert.rejects(()=>manager.run({...opened,version:manager.get(opened.id).version,command:'build'}),/Reload/);
  const reopened=await manager.open({kind:'local',path:root,trust:true});assert(reopened.files['src/main.rs'].includes('saved before failure'));assert(!reopened.needsRefresh);
});
