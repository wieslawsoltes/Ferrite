import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProcessRunner} from '../src/native/ProcessRunner.js';
import {CargoOutputParser} from '../src/native/CargoOutputParser.js';
import {CargoBridgeServer} from '../src/native/CargoBridgeServer.js';

test('native process supports streamed Unicode output and preserves failure code', async () => {
  const events=[]; const r=await new ProcessRunner().run(process.execPath,['-e','process.stdout.write("α🦀");process.stderr.write("bad");process.exitCode=7'],{onEvent:e=>events.push(e)});
  assert.equal(r.stdout,'α🦀');assert.equal(r.stderr,'bad');assert.equal(r.exitCode,7);assert(events.length>=2);
});
test('native process cancellation waits for close and reports nonzero status', async () => {
  const controller=new AbortController();const promise=new ProcessRunner().run(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});
  setTimeout(()=>controller.abort(),40);const r=await promise;assert.equal(r.exitCode,130);assert(r.cancelled);
});
test('native process timeout cannot be reported as success', async () => {
  const r=await new ProcessRunner().run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:40});assert.equal(r.exitCode,124);assert(r.timedOut);
});
test('Cargo JSON diagnostics and executable artifacts remain structured', () => {
  const data=JSON.stringify({reason:'compiler-message',message:{level:'error',message:'bad',code:{code:'E0308'},spans:[{file_name:'src/a.rs',line_start:2,column_start:3,is_primary:true}]}})+'\n'+JSON.stringify({reason:'compiler-artifact',executable:'/tmp/main',target:{name:'main'},filenames:[]});
  const r=CargoOutputParser.parse(data);assert.equal(r.diagnostics[0].code,'E0308');assert.equal(r.artifacts[0].executable,'/tmp/main');
});
test('loopback Cargo bridge enforces token, exact Origin and native execution boundary', async () => {
  let calls=0;
  const runner={async run(project,command,options){calls++;options.onEvent({kind:'stdout',text:'native\n'});return {exitCode:0,backend:'native-cargo',command};},async dispose(){}};
  const bridge=new CargoBridgeServer({runner,origins:['http://localhost:8080']});const c=await bridge.listen(0);
  try{
    assert.equal((await fetch(c.url+'/v1/capabilities')).status,401);
    const auth={Authorization:`Bearer ${c.token}`,Origin:'http://localhost:8080'};
    assert.equal((await fetch(c.url+'/v1/capabilities',{headers:{...auth,Origin:'https://evil.invalid'}})).status,403);
    assert.equal((await fetch(c.url+'/v1/capabilities',{headers:auth})).status,200);
    const r=await fetch(c.url+'/v1/run',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({command:'check',files:{'Cargo.toml':''}})});
    const records=(await r.text()).trim().split('\n').map(JSON.parse);assert.equal(records[0].type,'log');assert.equal(records.at(-1).result.exitCode,0);assert.equal(calls,1);
  }finally{await bridge.close();}
});

test('native materializer returns formatted Rust source changes for the IDE', async () => {
  const {ProjectMaterializer} = await import('../src/native/ProjectMaterializer.js');
  const {writeFile} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const materializer=await ProjectMaterializer.create({files:{'Cargo.toml':'[package]\nname="format-test"','src/main.rs':'fn main(){}'}});
  try { await writeFile(join(materializer.root,'src/main.rs'),'fn main() {}\n');const files=await materializer.outputFiles();assert.equal(files['src/main.rs'],'fn main() {}\n'); }
  finally { await materializer.dispose(); }
});
