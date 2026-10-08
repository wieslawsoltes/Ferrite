import {compile} from "../src/engine.js";
import assert from "node:assert/strict";
import vm from "node:vm";
const cases=[
  ["hello", 'fn greet<T: Display>(x: T) { println!("Hi {}", x); } fn main(){ greet("Rust"); greet(3u32); }', "Hi Rust\nHi 3\n"],
  ["arithmetic", 'fn main(){ let x = 2u32 + 3u32 * 4u32; println!("{}", x); }',"14\n"],
  ["mutable", 'fn main(){ let mut i = 0u32; while i < 3u32 { println!("{}", i); i += 1u32; } }',"0\n1\n2\n"],
  ["if", 'fn main(){ if true { println!("yes"); } else { println!("no"); } }',"yes\n"],
  ["array", 'fn main(){ let xs = [4u32,5u32]; println!("{}", xs[1u32]); }',"5\n"],
  ["return", 'fn sq(x: u32) -> u32 { x * x } fn main(){ println!("{}",sq(7u32)); }',"49\n"],
  ["boolean", 'fn main(){ if true && !false { println!("ok"); } }',"ok\n"],
  ["generic nested", 'fn one<T: Display>(x:T){println!("{}",x);} fn two<T: Display>(x:T){one(x);} fn main(){two(8u32);}',"8\n"]
];
let count=0;
for(const [name,src,expected] of cases){
  const result=compile(src);let actual="";
  vm.runInNewContext(result.js,{postMessage:x=>actual=x},{timeout:1000});
  assert.equal(actual,expected,name);count++;
}
for(const src of ['fn f(x:u32){} fn main(){f("bad");}','fn main(){let n=1u32;n=2u32;}']){
  assert.throws(()=>compile(src));count++;
}
console.log("PASS "+count+" compiler cases");
