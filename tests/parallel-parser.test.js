import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {ParserWorkerPool} from '../src/project/parallel/ParserWorkerPool.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {FileParserCache} from '../src/project/FileParserCache.js';

function workerFactory() {
  const entry=new URL('../src/ui/workers/parse-worker.js',import.meta.url).href;
  const worker=new Worker(`const {parentPort,threadId}=require('node:worker_threads');global.self={postMessage:data=>parentPort.postMessage({...data,threadId})};import(${JSON.stringify(entry)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
  const slot={postMessage:data=>worker.postMessage(data),terminate:()=>worker.terminate()};
  worker.on('message',data=>slot.onmessage?.({data}));worker.on('error',error=>slot.onerror?.(error));return slot;
}
function project(count=8){
  const files={'Cargo.toml':'[package]\nname="parallel"\nversion="0.1.0"\nedition="2021"'};
  files['src/main.rs']=Array.from({length:count},(_,i)=>`mod unit${i};`).join('\n')+'\nfn main(){println!("{}",unit0::value());}';
  for(let i=0;i<count;i++)files[`src/unit${i}.rs`]='// 🦀 café\n'.repeat(100)+`pub fn value()->i32{${i+42}}`;
  return files;
}
function stable(build){return {tokens:build.tokens,ast:build.ast,hir:build.hir,mir:build.mir,optimizedMir:build.optimizedMir,verification:build.verification,js:build.js,wasm:build.wasm.bytes};}

test('real worker threads lex/parse concurrently and produce exactly the serial compiler artifacts',async t=>{
  const files=project(),parallel=new CompilerSession(),pool=new ParserWorkerPool({workerFactory});t.after(()=>pool.dispose());
  const serial=new CompilerSession().compile(files,'check',{});
  const report=await pool.prewarm(files,parallel.syntax,{workers:4});const actual=parallel.compile(files,'check',{});
  assert.equal(report.usedWorkers,4);assert.equal(report.peakActiveTasks,4);assert.equal(report.parsedFiles,9);assert.equal(report.tasks.length,9);
  assert.equal(new Set([...parallel.syntax.entries.values()].map(value=>value.threadId)).size,4);
  assert.deepEqual(stable(actual),stable(serial));assert.equal(actual.cache.parsedFiles,9);
  assert.deepEqual((await pool.prewarm(files,parallel.syntax,{workers:4})).tasks,[]);
});
test('invalid inactive sources do not fail parallel builds, and reachable syntax errors keep serial diagnostics',async t=>{
  const files=project(2);files['src/main.rs']='#[cfg(any())] mod broken;\nmod unit0;mod unit1;fn main(){println!("{}",unit0::value());}';files['src/broken.rs']='fn { invalid Rust !';
  const session=new CompilerSession(),pool=new ParserWorkerPool({workerFactory});t.after(()=>pool.dispose());
  const report=await pool.prewarm(files,session.syntax,{workers:3,threshold:0});assert(report.tasks.some(t=>t.file==='src/broken.rs'&&t.deferredError));
  assert.deepEqual(stable(session.compile(files)),stable(new CompilerSession().compile(files)));
  files['src/main.rs']=files['src/main.rs'].replace('#[cfg(any())] ','');await pool.prewarm(files,session.syntax,{workers:2,threshold:0});
  let one,two;try{session.compile(files);}catch(error){one=error.toJSON();}try{new CompilerSession().compile(files);}catch(error){two=error.toJSON();}assert.deepEqual(one,two);assert(one);
});
test('cache eviction is deterministic despite out-of-order completions',async t=>{
  const files=project(4),pool=new ParserWorkerPool({workerFactory});t.after(()=>pool.dispose());
  const cache=new FileParserCache({maxEntries:2,maxCharacters:100000});await pool.prewarm(files,cache,{workers:4,threshold:0});
  assert.deepEqual([...cache.entries.keys()],['src/unit2.rs','src/unit3.rs']);assert.equal(cache.entries.size,2);
});
test('worker initialization failure transparently falls back to the unchanged serial parser',async()=>{
  const files=project(2),session=new CompilerSession(),pool=new ParserWorkerPool({workerFactory:()=>{throw Error('workers unavailable');}});
  const report=await pool.prewarm(files,session.syntax,{workers:2,threshold:0});assert.equal(report.usedWorkers,0);assert.match(report.fallbackReason,/unavailable/);
  assert.deepEqual(stable(session.compile(files)),stable(new CompilerSession().compile(files)));
});
test('aborted compilation rejects pending parser work and leaves the cache unchanged',async t=>{
  const pool=new ParserWorkerPool({workerFactory}),cache=new FileParserCache(),abort=new AbortController();t.after(()=>pool.dispose());
  const operation=pool.prewarm(project(12),cache,{workers:4,threshold:0,signal:abort.signal});abort.abort();await assert.rejects(operation,{name:'AbortError'});assert.equal(cache.entries.size,0);assert.equal(pool.slots.length,0);
});
test('small edits and a one-worker selection use the serial reference path',async()=>{
  const pool=new ParserWorkerPool({workerFactory:()=>{throw Error('should not start');}}),cache=new FileParserCache();
  assert.equal((await pool.prewarm(project(),cache,{workers:1})).usedWorkers,0);
  await assert.rejects(()=>pool.prewarm(project(),cache,{workers:9}),/1..8/);
  const abort=new AbortController();abort.abort();await assert.rejects(()=>pool.prewarm({},cache,{workers:1,signal:abort.signal}),{name:'AbortError'});
});
