#!/usr/bin/env node
/** Parser/full-pipeline measurements using real Node worker threads and production parser modules.
 * This is a workload report, never a fixed speedup assertion or a CI performance gate.
 */
import {Worker} from 'node:worker_threads';
import {availableParallelism, cpus} from 'node:os';
import {ParserWorkerPool} from '../src/project/parallel/ParserWorkerPool.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
const count=Number(process.argv[2]??4),functions=Number(process.argv[3]??20),iterations=Number(process.argv[4]??5);
for(const value of [count,functions,iterations])if(!Number.isSafeInteger(value)||value<1||value>1000)throw Error('Arguments must be integers from 1 to 1000');
const modules=Array.from({length:count},(_,i)=>'unit'+i);
const files={'Cargo.toml':'[package]\nname="parallel_measurement"\nversion="0.1.0"\nedition="2021"',
  'src/main.rs':modules.map(name=>`mod ${name};`).join('\n')+'\nfn main(){println!("{}",unit0::value());}'};
for(const name of modules)files['src/'+name+'.rs']='pub fn value()->i32{42}\n'+Array.from({length:functions},(_,i)=>`pub fn compute_${i}(value:i32)->i32 { let doubled=value*2; if doubled>42 { doubled-1 } else { doubled+1 } }`).join('\n');
const entry=new URL('../src/ui/workers/parse-worker.js',import.meta.url).href;
const workerFactory=()=>{
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:value=>parentPort.postMessage(value)};import(${JSON.stringify(entry)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
  const adapter={postMessage:data=>worker.postMessage(data),terminate:()=>worker.terminate()};worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));return adapter;
};
const records=[];
for(const workers of [1,2,4]){
  const pool=new ParserWorkerPool({workerFactory});
  try{
    for(let iteration=0;iteration<iterations;iteration++){
      const session=new CompilerSession(),begin=performance.now();
      const report=await pool.prewarm(files,session.syntax,{workers,threshold:0});
      const build=session.compile(files,'check',{});
      records.push({workers,iteration,workerState:iteration===0?'cold':'retained',sourceState:'cold',pipelineMs:performance.now()-begin,poolMs:report.wallMs,workerTaskMs:report.taskMs,parsedFiles:build.cache.parsedFiles,wasmBytes:build.wasm.bytes.length,peakInFlight:report.peakActiveTasks});
    }
  }finally{pool.dispose();}
}
console.log(JSON.stringify({environment:{node:process.version,availableParallelism:availableParallelism(),cpu:cpus()[0]?.model},workload:{files:count+1,functionsPerModule:functions,sourceCharacters:Object.values(files).join('').length,iterations},records,note:'Retained workers, cold per-iteration compiler caches. Dispatch overlap is not CPU utilization. Structured cloning/startup can outweigh parallel work, especially on small sources. These Node measurements are not browser or native Cargo benchmarks.'},null,2));
