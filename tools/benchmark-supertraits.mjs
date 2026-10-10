import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {parse,tokenize} from '../src/engine.js';
import {SymbolIndex} from '../src/compiler/SymbolIndex.js';
import {TraitHierarchy} from '../src/compiler/TraitHierarchy.js';

// Isolated membership benchmark, not a historical/end-to-end compiler comparison.
const options={iterations:9,queries:2048,output:'artifacts/performance/supertraits.json'};
for(let i=2;i<process.argv.length;i++){
  const argument=process.argv[i];
  if(argument==='--output')options.output=process.argv[++i];
  else if(argument==='--iterations'||argument==='--queries')options[argument.slice(2)]=Number(process.argv[++i]);
  else throw new Error(`Unknown argument ${argument}`);
}
if(!Number.isSafeInteger(options.iterations)||options.iterations<1||options.iterations>101||
   !Number.isSafeInteger(options.queries)||options.queries<1||options.queries>65536||
   typeof options.output!=='string'||!options.output)throw new Error('Invalid benchmark arguments');
const summary=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return {medianMs:sorted[Math.floor(sorted.length/2)],minMs:sorted[0],p95Ms:sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]};
};
const timed=action=>{const start=performance.now(),value=action();return {milliseconds:performance.now()-start,value};};
let seed=42;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
const report={schema:1,node:process.version,platform:process.platform,architecture:process.arch,options,
  scope:'Isolated supertrait-membership queries over one canonical DAG; not total compiler speed',
  warmSetup:'Parsing, symbol indexing, hierarchy construction and closure warmup are outside the warm-query measurements',
  coldSetup:'Cold measurements include hierarchy construction and all requested queries; parsing and symbol indexing are excluded',
  workloads:[]};
try{report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  report.tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
  report.dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0;
}catch{/* Git metadata is optional in exported source archives. */}
for(const size of [128,512]){
  const parents=Array.from({length:size},(_,i)=>[i-1,i-7,i-23].filter(j=>j>=0).map(j=>`T${j}`));
  const source=parents.map((edges,i)=>`trait T${i}${edges.length?':'+edges.join('+'):''}{}`).join('\n');
  const index=new SymbolIndex(parse(tokenize(source)));
  const queries=Array.from({length:options.queries},()=>[`T${random()%size}`,`T${random()%size}`]);
  const oracle=(child,parent)=>{
    if(child===parent)return true;
    const seen=new Set(),queue=[...parents[Number(child.slice(1))]];
    while(queue.length){
      const current=queue.pop();if(current===parent)return true;if(seen.has(current))continue;seen.add(current);
      for(const next of parents[Number(current.slice(1))])queue.push(next);
    }
    return false;
  };
  const execute=check=>Uint8Array.from(queries,([child,parent])=>Number(check(child,parent)));
  const expected=execute(oracle),graph=new TraitHierarchy(index);
  for(let i=0;i<size;i++)graph.ancestors(`T${i}`);
  assert.deepEqual(execute((c,p)=>graph.implies(c,p)),expected);
  const cached=[],linear=[],cold=[];
  for(let iteration=0;iteration<options.iterations;iteration++){
    const actions=[['cached',()=>execute((c,p)=>graph.implies(c,p))],['linear',()=>execute(oracle)]];
    if(iteration%2)actions.reverse();
    for(const [name,action] of actions){const sample=timed(action);assert.deepEqual(sample.value,expected);(name==='cached'?cached:linear).push(sample.milliseconds);}
    const sample=timed(()=>{const fresh=new TraitHierarchy(index);return execute((c,p)=>fresh.implies(c,p));});
    assert.deepEqual(sample.value,expected);cold.push(sample.milliseconds);
  }
  report.workloads.push({traits:size,queries:queries.length,edges:parents.reduce((n,p)=>n+p.length,0),
    sourceSha256:createHash('sha256').update(source).digest('hex'),
    outputSha256:createHash('sha256').update(expected).digest('hex'),
    validatedAllQueryResults:true,indexedWarm:summary(cached),exhaustive:summary(linear),indexedCold:summary(cold),
    samples:{indexedWarmMs:cached,exhaustiveMs:linear,indexedColdMs:cold},cache:graph.snapshot()});
}
mkdirSync(dirname(options.output),{recursive:true});writeFileSync(options.output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
