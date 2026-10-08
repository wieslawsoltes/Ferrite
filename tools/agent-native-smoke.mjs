import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentRuntime} from '../src/agent/server/AgentRuntime.js';
const root=await mkdtemp(join(tmpdir(),'ferrite-agent-native-'));let runtime;
try {
  await mkdir(join(root,'workspace/src'),{recursive:true});
  await writeFile(join(root,'workspace/Cargo.toml'),'[package]\nname="agent-native-smoke"\nversion="0.1.0"\nedition="2021"\n');
  await writeFile(join(root,'workspace/src/main.rs'),'fn square(value: i32) -> i32 { value * value }\nfn main() { println!("{}", square(7)); }\n#[test] fn squares() { assert_eq!(square(3), 9); }\n');
  runtime=await AgentRuntime.create({root:join(root,'workspace'),state:join(root,'state'),environment:{}});
  const context={sessionId:'native-smoke',mode:'trusted',interactive:false};
  const test=await runtime.tools.execute('cargo',{args:['test','--offline','--message-format=json','--jobs','2']},context);assert.equal(test.exitCode,0,JSON.stringify(test));
  const run=await runtime.tools.execute('cargo',{args:['run','--offline','--quiet']},context);assert.equal(run.exitCode,0,JSON.stringify(run));assert.equal(run.stdout.trim(),'49');
  assert.ok(await readFile(join(root,'workspace/Cargo.lock'),'utf8'));
  const hover=await runtime.tools.execute('rust_language',{method:'textDocument/hover',path:'src/main.rs',params:{position:{line:0,character:4}}},context);assert.ok(hover.result?.contents,JSON.stringify(hover));
  const symbols=await runtime.tools.execute('rust_language',{method:'textDocument/documentSymbol',path:'src/main.rs'},context);assert.ok(symbols.result.some(symbol=>symbol.name==='square'),JSON.stringify(symbols));
  const syntax=await runtime.tools.execute('rust_language',{method:'rust-analyzer/viewSyntaxTree',path:'src/main.rs'},context);assert.ok(syntax.result||syntax.artifact,JSON.stringify(syntax));
  console.log('PASS agent tools: persistent native Cargo test/run/--jobs, Cargo.lock, rust-analyzer hover/symbols/syntax tree');
} finally {await runtime?.close();await rm(root,{recursive:true,force:true});}
