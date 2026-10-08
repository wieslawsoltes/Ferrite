#!/usr/bin/env node
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {WorkspaceEditPlan} from '../src/ui/model/WorkspaceEditPlan.js';
import {SourceFile} from '../src/project/SourceFile.js';
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
  const inspection=await run('inspect',{args:['--package','smoke-app','--bin','smoke-app']});
  assert.equal(inspection.exitCode,0,inspection.stderr);
  for(const kind of ['mir','llvm-ir','asm','obj'])assert(inspection.compilerArtifacts.some(a=>a.kind===kind&&a.size>0),'Missing native artifact '+kind);
  assert(inspection.compilerArtifacts.find(a=>a.kind==='llvm-ir').content.includes('define '));
  assert(inspection.compilerArtifacts.find(a=>a.kind==='llvm-ir').mappings.some(m=>m.span.file==='app/src/main.rs'));
  assert(inspection.compilerArtifacts.find(a=>a.kind==='asm').mappings.some(m=>m.span.file==='app/src/main.rs'));
  assert(inspection.compilerArtifacts.find(a=>a.kind==='obj').encoding==='base64');
  const formatted=await run('fmt',{args:['--all']});assert.equal(formatted.exitCode,0);assert.equal(formatted.files['app/src/main.rs'],'fn main() {\n    println!("native {}", smoke_math::answer());\n}\n');
  const browserLanguageCases=[
    ['fn apply<F: Fn(i32)->i32>(f:F,v:i32)->i32{f(v)} fn main(){let scale=6;let f=|x|x*scale;println!("{}",apply(f,7));}', '42'],
    ['fn make(x:i32)->impl Fn(i32)->i32{move|y:i32|x+y} fn main(){let f=make(40);println!("{}",f(2));}', '42'],
    ['fn main(){let mut n=1;let mut f=||{n+=1;n};println!("{} {}",f(),f());}', '2 3']
  ];
  for(const [source,expected] of browserLanguageCases){files['app/src/main.rs']=source;const actual=await run('run',{args:['--package','smoke-app']});assert.equal(actual.exitCode,0);assert(actual.stdout.includes(expected));}
  const conformanceCases = [
    ['enum Event{Left(i32),Right(i32),Idle} fn f(e:Event)->i32{let (Event::Left(v)|Event::Right(v))=e else{return 0;};v}fn main(){println!("{} {} {}",f(Event::Left(3)),f(Event::Right(5)),f(Event::Idle));}', '3 5 0\n'],
    ['fn main(){for value in [Some(4),None,Some(8)]{let Some(n)=value else{continue;};println!("accepted {}",n);}}', 'accepted 4\naccepted 8\n'],
    ['fn classify(n:u8)->i32{match n{0..=127=>1,128..=255=>2}}fn main(){println!("{} {}",classify(4),classify(200));}', '1 2\n'],
    ['type Pair<T>=(T,T);fn first<T>(v:Pair<T>)->T where T:Copy{v.0}fn main(){let p:Pair<u32>=(7,8);println!("{}",first(p));}', '7\n'],
    ['struct Point{x:i32}type P=Point;type R=Result<u32,i32>;fn main(){let P{x}=P{x:4};let n=R::Ok(9);println!("{} {}",x,match n{R::Ok(v)=>v,R::Err(_)=>0});}', '4 9\n']
  ];
  for(const [source,expected] of conformanceCases){
    const browser=compile(source),interpreted=new MirVirtualMachine(browser.optimizedMir,{entry:browser.entry}).run().output;
    const wasm=new WebAssemblyRuntime(browser.wasm).run().output;
    // Compare only program stdout. JSON-mode Cargo also writes compiler records to stdout.
    files['app/src/main.rs']=source;const actual=await run('run',{json:false,args:['--package','smoke-app']});
    assert.equal(actual.exitCode,0,actual.stderr);assert.equal(actual.stdout,expected);
    assert.equal(interpreted,actual.stdout);assert.equal(wasm,actual.stdout);
  }
  files['app/src/main.rs']='pub fn doubled(value:i32)->i32 {value*2}\nfn main(){println!("{}", doubled(21));}\n';
  const lspFile='app/src/main.rs';
  const position=(needle,delta=1)=>{const p=new SourceFile(lspFile,files[lspFile]).position(files[lspFile].lastIndexOf(needle)+delta);return {line:p.line-1,character:p.column-1};};
  const language=async(command,options={})=>{const result=await client.language(files,'textDocument/'+command,{file:lspFile,position:position('doubled'),...options});cases.push({command:'rust-analyzer '+command});return result;};
  const definition=await language('definition');assert(definition.locations.some(l=>l.span.file===lspFile&&l.span.line===1));
  const references=await language('references');assert(references.locations.length>=2);
  const hover=await language('hover');assert(hover.text.includes('doubled'));
  const renamed=await language('rename',{newName:'twice'}),transaction=WorkspaceEditPlan.prepare(files,renamed.changes);assert(transaction.count>=2);Object.assign(files,transaction.files);
  assert.equal((await run('run',{args:['--package','smoke-app']})).exitCode,0);
  files[lspFile]='pub fn doubled(value:i32)->i32 {value*2}\nfn main(){doub}\n';
  const completions=await language('completion',{position:position('doub}',4)});assert(completions.items.some(item=>item.label.startsWith('doubled')));
  files['app/src/main.rs']='fn main() { let value: u32 = "type error"; println!("{}",value); }\n';
  const invalid=await run('check');assert.notEqual(invalid.exitCode,0);assert(invalid.diagnostics.some(d=>d.code==='E0308'));
  const output=process.env.FERRITE_NATIVE_OUTPUT??'artifacts/native';await mkdir(output,{recursive:true});await writeFile(`${output}/results.json`,JSON.stringify({backend:'installed-cargo',cases},null,2));
  console.log(`PASS ${cases.length} real native Cargo operations including workspace/path dependencies, fmt and diagnostics`);
}finally{client.disconnect();await bridge.close();}
