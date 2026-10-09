import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import assert from 'node:assert/strict';
import {parse,tokenize} from '../src/engine.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';

const args=process.argv.slice(2);let iterations=5,output=null;
for(let i=0;i<args.length;i++){
  if(args[i]==='--iterations')iterations=Number(args[++i]);
  else if(args[i]==='--output')output=args[++i];
  else throw new Error('Usage: node tools/benchmark-impls.mjs [--iterations 1..100] [--output file.json]');
}
if(!Number.isInteger(iterations)||iterations<1||iterations>100)throw new Error('Iterations must be an integer in 1..100');
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const workloads=[];
for(const owners of [128,512]){
  const source=Array.from({length:owners},(_,i)=>`struct Type${i}<T>(T);impl<T> Type${i}<T>{fn get(self)->T{self.0}}`).join('\n')+'\nfn main(){}';
  const analyzer=new SemanticAnalyzer(parse(tokenize(source))),resolver=analyzer.implementations,index=resolver.byOwner;
  const queries=1024,targets=Array.from({length:queries},(_,i)=>`Type${(i*37)%owners}<u32>`);
  const node={span:null},times={indexed:[],linear:[]},selected={};
  const trial=mode=>{
    // Exhaustive candidate enumeration is the sole changed operation. Matching,
    // bounds, ambiguity and visibility use the production resolver in both modes.
    resolver.byOwner=mode==='indexed'?index:{get:()=>({get:()=>resolver.entries})};
    const start=performance.now(),result=[];
    try{for(const owner of targets){const match=resolver.lookup(owner,'get','',node);result.push([match.fn.name,[...match.mapping]]);}}
    finally{resolver.byOwner=index;}
    const ms=performance.now()-start;
    if(selected.indexed)assert.deepEqual(result,selected.indexed);else selected[mode]=result;
    return ms;
  };
  trial('indexed');trial('linear');
  for(let i=0;i<iterations;i++)for(const mode of i%2?['linear','indexed']:['indexed','linear'])times[mode].push(trial(mode));
  workloads.push({owners,queries,iterations,medianMs:{indexed:median(times.indexed),linear:median(times.linear)},samplesMs:times});
}
const report={kind:'lookup-only, paired indexed/exhaustive candidate enumeration',node:process.version,platform:process.platform,arch:process.arch,workloads};
console.log(JSON.stringify(report,null,2));
if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
