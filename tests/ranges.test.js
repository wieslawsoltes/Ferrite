import {test} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {compile} from "../src/engine.js";
test("for range exclusive, inclusive and nested loops",()=>{
const src='fn main(){ for i in 0u32..3u32 { println!("{}",i); } for j in 1u32..=2u32 { println!("{}",j); }}';
const output=compile(src);let result=null;
vm.runInNewContext(output.js,{postMessage:v=>{result=v}},{timeout:500});
assert.equal(result,"0\n1\n2\n1\n2\n");
assert(output.mir.some(i=>i.blocks.some(b=>b.terminator?.kind==="rangeSwitch")));
});
test("reject invalid range types",()=>assert.throws(()=>compile('fn main(){ for i in 0u32..1.0f64 { println!("{}",i); } }'),/range requires matching/));
