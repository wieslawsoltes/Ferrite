import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {compile, parse, tokenize} from '../src/engine.js';
import {SymbolIndex} from '../src/compiler/SymbolIndex.js';

const options = {iterations:25, output:null};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--iterations') options.iterations = Number(process.argv[++i]);
  else if (key === '--output') { options.output = process.argv[++i]; if (!options.output) throw Error('Missing output path'); }
  else throw Error(`Unknown option ${key}`);
}
if (!Number.isSafeInteger(options.iterations) || options.iterations < 3 || options.iterations > 1000)
  throw Error('Iteration count must be an integer in [3, 1000]');
const summary = samples => {
  const sorted = samples.toSorted((a,b) => a-b);
  return {p50:sorted[Math.floor((sorted.length-1)*.5)], p95:sorted[Math.floor((sorted.length-1)*.95)]};
};
const measurePair = (left, right) => {
  for (let i=0; i<3; i++) { left(); right(); }
  const samples=[[],[]], actions=[left,right];
  for (let i=0; i<options.iterations; i++) for (const which of i%2 ? [1,0] : [0,1]) {
    const start = performance.now(); actions[which](); samples[which].push(performance.now()-start);
  }
  return {linearMs:summary(samples[0]), indexedMs:summary(samples[1])};
};
const report = {schema:1,node:process.version,platform:process.platform,arch:process.arch,
  iterations:options.iterations,notes:'Alternating same-process measurements. Lookup-only includes cold index creation. Cold-compile comparison changes only field lookup to the previous Array.find algorithm; it is not a historical compiler comparison or a universal speedup.',lookup:[],compile:[]};
const indexedField = SymbolIndex.prototype.field;
const linearField = function(shape,name) { return shape?.fields.find(field=>field.name===name); };
try {
  for (const width of [16, 128, 1024, 4096]) {
    const shape = {fields:Array.from({length:width},(_,i)=>({name:`f${i}`,type:'i32'}))};
    const ast = parse(tokenize('struct Empty;'));
    const names = shape.fields.map(field=>field.name).reverse();
    const lookup = indexed => {
      const index = new SymbolIndex(ast); let checksum=0;
      for (let pass=0;pass<4;pass++) for (const name of names) {
        const field = indexed ? index.field(shape,name) : linearField(shape,name);
        checksum += field.name.length;
      }
      return checksum;
    };
    assert.equal(lookup(false),lookup(true));
    report.lookup.push({width,queries:width*4,...measurePair(()=>lookup(false),()=>lookup(true))});
  }
  for (const width of [16, 128, 512]) {
    const fields = Array.from({length:width},(_,i)=>`f${i}:i32`).join(',');
    const values = Array.from({length:width},(_,i)=>`f${i}:${i}`).reverse().join(',');
    const source = `struct Wide{${fields}}fn main(){let w=Wide{${values}};println!("{}",w.f${width-1});}`;
    const build = indexed => { SymbolIndex.prototype.field=indexed?indexedField:linearField; return compile(source); };
    const left=build(false),right=build(true);
    assert.deepEqual(left.optimizedMir,right.optimizedMir);assert.equal(left.js,right.js);assert.deepEqual(left.wasm.bytes,right.wasm.bytes);
    report.compile.push({width,...measurePair(()=>build(false),()=>build(true))});
  }
} finally { SymbolIndex.prototype.field=indexedField; }
const json=JSON.stringify(report,null,2)+'\n';
if(options.output){mkdirSync(dirname(options.output),{recursive:true});writeFileSync(options.output,json);}
process.stdout.write(json);
