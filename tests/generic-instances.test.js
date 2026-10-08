import {test} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {compile} from "../src/engine.js";
import {CallGraphBuilder} from "../src/compiler/CallGraphBuilder.js";
test("independent generic specializations preserve call targets",()=>{
const source='fn inner<T: Display>(v:T){println!("{}",v);} fn outer<T: Display>(v:T){inner(v);} fn main(){outer("hello");outer(42u32);}';
const result=compile(source);
const stringCall=result.sem.instances.find(x=>x.key==="outer<&str>")?.calls[0];
const integerCall=result.sem.instances.find(x=>x.key==="outer<u32>")?.calls[0];
assert.equal(stringCall?.to,"inner<&str>");
assert.equal(integerCall?.to,"inner<u32>");
const graph=CallGraphBuilder.build(result.ast,result.sem.instances);
assert(graph.edges.some(x=>x.from==="outer<&str>"&&x.to==="inner<&str>"));
assert(graph.edges.some(x=>x.from==="outer<u32>"&&x.to==="inner<u32>"));
let output="";vm.runInNewContext(result.js,{postMessage:value=>output=value},{timeout:1000});
assert.equal(output,"hello\n42\n");
});
