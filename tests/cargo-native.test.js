import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {validateSnapshot,materialize,commands} from "../tools/cargo-native.mjs";
test("native Cargo snapshot is validated and materialized",async()=>{
 const files={"Cargo.toml":'[package]\nname="test"\nversion="0.1.0"',"src/main.rs":"fn main(){}"};
 const root=await materialize({files});
 try{assert.equal(await readFile(join(root,"src/main.rs"),"utf8"),"fn main(){}");}
 finally{await rm(root,{recursive:true,force:true});}
 assert(commands.has("test"));assert(commands.has("metadata"));
});
test("native Cargo adapter rejects traversal and invalid payload",()=>{
 for(const path of ["../evil","src/../bad.rs","/etc/passwd",".","a//b"]){
  assert.throws(()=>validateSnapshot({files:{"Cargo.toml":"","src/main.rs":"", [path]:"oops"}}));
 }
 assert.throws(()=>validateSnapshot({files:{"src/main.rs":"fn main(){}"}}),/Missing Cargo.toml/);
});
