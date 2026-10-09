import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {cpus, arch, platform, release} from 'node:os';
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {compile} from '../src/engine.js';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {initializationGraph} from '../tests/fixtures/mir-initialization.js';

const args=process.argv.slice(2), options={iterations:25,baseline:null,output:null};
for(let index=0;index<args.length;index++) {
  const value=args[++index];
  if(args[index-1]==='--iterations') options.iterations=Number(value);
  else if(args[index-1]==='--baseline-ref') options.baseline=value;
  else if(args[index-1]==='--output') options.output=value;
  else throw new Error(`Unknown argument ${args[index-1]}`);
  if(value===undefined) throw new Error('Missing argument value');
}
if(!Number.isSafeInteger(options.iterations)||options.iterations<5||options.iterations>500) throw new Error('Iterations must be between 5 and 500');
let baseline;
if(options.baseline) {
  if(!/^[0-9a-f]{7,40}$/.test(options.baseline)) throw new Error('Baseline must be an immutable commit hash');
  let source=execFileSync('git',['show',`${options.baseline}:src/compiler/MirVerifier.js`],{encoding:'utf8',maxBuffer:1024*1024});
  const diagnostic=new URL('../src/compiler/Diagnostic.js',import.meta.url).href;
  source=source.replace("from './Diagnostic.js'",`from '${diagnostic}'`);
  baseline=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).MirVerifier;
}
const source=`fn sum(n:i32)->i32{let mut x=0;for i in 0..n{if i%2==0{x+=i;}else{x-=1;}}x}fn main(){println!("{}",sum(100));}`;
const workloads=[
  ['source-generated control flow',compile(source,{optimize:false}).mir],
  ['synthetic cyclic 128 blocks / 2048 registers',[initializationGraph(7,2048,128,false)]],
  ['synthetic cyclic 256 blocks / 4096 registers',[initializationGraph(19,4096,256,false)]],
];
const summarize=samples=>{
  const sorted=samples.toSorted((a,b)=>a-b), at=q=>sorted[Math.floor((sorted.length-1)*q)];
  return {p50:at(.5),p95:at(.95),max:at(1),samples};
};
const results=[];
for(const [name,functions] of workloads) {
  const implementations=[['current',MirVerifier],...(baseline?[['baseline',baseline]]:[])];
  for(const [,verifier] of implementations) for(let n=0;n<5;n++) verifier.verify(functions);
  const samples=Object.fromEntries(implementations.map(([name])=>[name,[]]));
  for(let n=0;n<options.iterations;n++) for(const [key,verifier] of n%2?implementations.toReversed():implementations) {
    const start=performance.now(); verifier.verify(functions); samples[key].push(performance.now()-start);
  }
  results.push({name,functions:functions.length,blocks:functions.reduce((n,f)=>n+f.blocks.length,0),
    registers:functions.reduce((n,f)=>n+f.registers.length,0),
    milliseconds:Object.fromEntries(Object.entries(samples).map(([key,value])=>[key,summarize(value)]))});
}
const report={schema:1,node:process.version,platform:platform(),release:release(),architecture:arch(),cpu:cpus()[0]?.model,
  iterations:options.iterations,baseline:options.baseline,workloads:results,
  note:'Paired alternating-order wall-clock samples of the verifier only. Synthetic stress fixtures are not end-to-end compiler or application speedups.'};
const json=JSON.stringify(report,null,2)+'\n';
if(options.output){mkdirSync(dirname(options.output),{recursive:true});writeFileSync(options.output,json);}
console.log(json);
