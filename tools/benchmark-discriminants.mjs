import assert from 'node:assert/strict';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';

const options={iterations:7,output:'artifacts/performance/discriminants.json'};
for(let i=2;i<process.argv.length;i++) {
  if(process.argv[i]==='--iterations') options.iterations=Number(process.argv[++i]);
  else if(process.argv[i]==='--output') options.output=process.argv[++i];
  else throw new Error(`Unknown argument ${process.argv[i]}`);
}
if(!Number.isSafeInteger(options.iterations)||options.iterations<3||options.iterations>100||!options.output)
  throw new Error('Expected 3..100 paired iterations and a nonempty output path');
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
// Controlled ablation of module-table hoisting, not a historical compiler. All
// other emitted instructions, Runtime semantics and instruction budgets match.
function inlineTables(code) {
  const tables=new Map();
  const result=code.replace(/^const (d\d+)=Object\.freeze\((.*)\);$/gm,(_,name,json)=>{JSON.parse(json);tables.set(name,json);return '';})
    .replace(/r\.discriminant\((c\[\d+\]\.value),(d\d+)\)/g,(_,value,name)=>{
      assert.ok(tables.has(name)); return `r.discriminant(${value},${tables.get(name)})`;
    });
  assert.ok(tables.size>0);return result;
}
const report={schema:1,node:process.version,platform:process.platform,arch:process.arch,iterations:options.iterations,
  description:'Paired generated-JavaScript execution: identical code except discriminant tables hoisted versus materialized per cast. No global compiler speedup claim.',cases:[]};
for(const width of [64,512,2048]) {
  const repetitions=1000;
  const source=`#[derive(Copy,Clone)]enum E{${Array.from({length:width},(_,i)=>`V${i}`).join(',')}}fn main(){let e=E::V${width-1};let mut sum=0i64;for _ in 0..${repetitions}{sum+=e as i64;}println!("{}",sum);}`;
  const compiled=compile(source), expected=`${(width-1)*repetitions}\n`;
  assert.equal(new MirVirtualMachine(compiled.optimizedMir,{entry:compiled.entry,maxTrace:0}).run().output,expected);
  assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output,expected);
  const code={hoisted:compiled.js,inline:inlineTables(compiled.js)};
  const scripts=Object.fromEntries(Object.entries(code).map(([kind,text])=>[kind,new vm.Script(text+'\nr.output;')]));
  const samples={hoisted:[],inline:[]};
  for(let i=-2;i<options.iterations;i++) for(const kind of i%2===0?['inline','hoisted']:['hoisted','inline']) {
    const context=vm.createContext({});const start=performance.now();
    const output=scripts[kind].runInContext(context,{timeout:5000}); const elapsed=performance.now()-start;
    assert.equal(output,expected); if(i>=0)samples[kind].push(elapsed);
  }
  report.cases.push({variants:width,casts:repetitions,jsBytes:Object.fromEntries(Object.entries(code).map(([k,text])=>[k,Buffer.byteLength(text)])),
    medianMilliseconds:{inline:median(samples.inline),hoisted:median(samples.hoisted)},samples,output:expected});
}
mkdirSync(dirname(options.output),{recursive:true});writeFileSync(options.output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
