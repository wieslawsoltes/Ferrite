import {test} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {compile} from "../src/engine.js";
test("match with numeric arms and wildcard",()=>{
const source='fn classify(x:u32)->u32 { match x { 0u32 => 10u32, 1u32 => 20u32, _ => 99u32 } } fn main(){ println!("{}",classify(1u32)); println!("{}",classify(9u32)); }';
const result=compile(source);let text="";
vm.runInNewContext(result.js,{postMessage:x=>{text=x}},{timeout:1000});
assert.equal(text,"20\n99\n");
});
test("boolean match is exhaustive without wildcard",()=>{
const result=compile('fn choose(x:bool)->u32 { match x { true => 1u32, false => 2u32 } } fn main(){ println!("{}",choose(true)); }');
let text="";vm.runInNewContext(result.js,{postMessage:x=>{text=x}},{timeout:1000});
assert.equal(text,"1\n");
});
test("match rejects mismatched arm types and missing coverage",()=>{
assert.throws(()=>compile('fn main(){ let x=match 7u32 { 1u32 => 2u32 }; }'),/Non-exhaustive/);
assert.throws(()=>compile('fn main(){ let x=match 7u32 { 1u32 => true, _ => 2u32 }; }'),/Incompatible match/);
});
