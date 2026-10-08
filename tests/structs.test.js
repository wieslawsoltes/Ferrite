import {test} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {compile} from "../src/engine.js";
test("struct literals and field projection",()=>{
 const code='struct Point { x: u32, y: u32 } fn distance(p: Point) -> u32 { p.x + p.y } fn main(){ let p=Point { x:3u32, y:4u32 }; println!("{}",distance(p)); }';
 const result=compile(code);let output="";
 vm.runInNewContext(result.js,{postMessage:v=>output=v},{timeout:1000});
 assert.equal(output,"7\n");
 assert.equal(result.sem.structures[0].name,"Point");
});
test("reject missing and mismatched struct fields",()=>{
 assert.throws(()=>compile('struct P{x:u32,y:u32} fn main(){let p=P{x:1u32};}'),/number of fields/);
 assert.throws(()=>compile('struct P{x:u32} fn main(){let p=P{x:"bad"};}'),/Field P.x expects/);
});
