#!/usr/bin/env node
/** Real installed Cargo integration; no fake process and no registry dependencies. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {CargoBridgeServer} from '../src/native/CargoBridgeServer.js';
import {NativeCargoClient} from '../src/ui/services/NativeCargoClient.js';

const bridge=new CargoBridgeServer();
const connection=await bridge.listen(0),client=new NativeCargoClient(),cases=[];
const files={
  'Cargo.toml':'[workspace]\nmembers = ["app", "math"]\nresolver = "2"\n',
  'app/Cargo.toml':'[package]\nname="smoke-app"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nsmoke-math={path="../math"}\n',
  'app/src/main.rs':'fn main(){println!("native {}", smoke_math::answer());}\n',
  'math/Cargo.toml':'[package]\nname="smoke-math"\nversion="0.1.0"\nedition="2021"\n',
  'math/src/lib.rs':'pub fn answer()->u32{42}\n#[test]\nfn test_answer(){assert_eq!(answer(),42);}\n'
};
async function run(command,options={}){
  const events=[],result=await client.run(files,command,{json:true,offline:command!=='fmt',...options},event=>events.push(event));
  for(const [path,text] of Object.entries(result.files??{}))files[path]=text;
  cases.push({command,exitCode:result.exitCode,elapsedMs:result.elapsedMs,events:events.length});
  return result;
}
try{
  await client.connect(connection.url,connection.token);
  assert.equal((await run('check')).exitCode,0);
  const built=await run('build');assert.equal(built.exitCode,0);assert(built.artifacts.some(a=>a.executable));
  const result=await run('run',{args:['--package','smoke-app']});assert.equal(result.exitCode,0);assert.match(result.stdout,/native 42/);
  const tests=await run('test');assert.equal(tests.exitCode,0);assert.match(tests.stdout,/test_answer/);
  const meta=await run('metadata');assert.equal(meta.exitCode,0);const metadata=JSON.parse(meta.stdout);assert.equal(metadata.workspace_members.length,2);
  const formatted=await run('fmt',{args:['--all']});assert.equal(formatted.exitCode,0);assert.equal(formatted.files['app/src/main.rs'],'fn main() {\n    println!("native {}", smoke_math::answer());\n}\n');
  files['app/src/main.rs']='fn main() { let value: u32 = "type error"; println!("{}",value); }\n';
  const invalid=await run('check');assert.notEqual(invalid.exitCode,0);assert(invalid.diagnostics.some(d=>d.code==='E0308'));
  const output=process.env.FERRITE_NATIVE_OUTPUT??'artifacts/native';await mkdir(output,{recursive:true});await writeFile(`${output}/results.json`,JSON.stringify({backend:'installed-cargo',cases},null,2));
  console.log(`PASS ${cases.length} real native Cargo operations including workspace/path dependencies, fmt and diagnostics`);
}finally{client.disconnect();await bridge.close();}
