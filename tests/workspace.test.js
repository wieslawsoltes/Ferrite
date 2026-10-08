import {test} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {parseManifest,cargoPlan,mergeCrateSources} from "../src/cargo.js";
import {compileProject} from "../src/project.js";
import {sampleProjects} from "../src/samples.js";
test("Cargo manifest metadata and dependencies",()=>{
 const m=parseManifest('[package]\nname = "demo"\nversion = "0.1.0"\n[dependencies]\nserde = "1.0"\n');
 assert.equal(m.package.name,"demo");assert.equal(m.dependencies.serde,"1.0");
});
test("Local module assembly",()=>{
 const files={"Cargo.toml":'[package]\nname = "a"',"src/main.rs":"mod helpers;\nfn main(){ helpers(); }","src/helpers.rs":"fn helpers(){ println!(\"ok\"); }"};
 const unit=mergeCrateSources(files);assert(unit.source.includes("fn helpers()"));assert(unit.source.includes("fn main()"));assert.deepEqual(unit.modules,["src/main.rs","src/helpers.rs"]);
});
test("Cargo rejects external dependencies instead of silently ignoring them",()=>{
 const project={...sampleProjects["Generics & modules"],"Cargo.toml":'[package]\nname = "hello"\n[dependencies]\nserde = "1.0"'};
 assert.throws(()=>compileProject(project),/External Cargo dependencies/);
});
for(const [name,project] of Object.entries(sampleProjects)){
 if(name==="Compiler diagnostic"){test(name+" expected failure",()=>assert.throws(()=>compileProject(project)));continue;}
 test(name,()=>{
  const built=compileProject(project);let output="";
  vm.runInNewContext(built.js,{postMessage:x=>output=x},{timeout:1000});
  assert.equal(typeof output,"string");assert(built.stages.length>=8);assert(built.unit.modules.length>=1);
 });
}
