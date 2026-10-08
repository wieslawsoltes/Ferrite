import {test} from "node:test";
import assert from "node:assert/strict";
import {TomlParser} from "../src/cargo/TomlParser.js";
import {ModuleAssembler} from "../src/cargo/ModuleAssembler.js";
import {parseManifest,mergeCrateSources} from "../src/cargo.js";
import {compileProject} from "../src/project.js";
test("TOML arrays, inline dependency specifications and dotted tables",()=>{
const manifest=parseManifest('[package]\nname = "foo"\nversion = "0.1.0"\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n[features]\ndefault = ["std", "alloc"]\n[profile.release]\nopt-level = 3\n');
assert.deepEqual(manifest.dependencies.serde,{version:"1",features:["derive"]});
assert.deepEqual(manifest.sections.features.default,["std","alloc"]);
assert.equal(manifest.sections.profile.release["opt-level"],3);
assert.equal(manifest.errors.length,0);
});
test("Module source offsets roundtrip across multiple declarations",()=>{
const files={"src/main.rs":"fn first(){}\nmod util;\nfn main(){util_fn();}","src/util.rs":"fn util_fn(){}"};
const unit=mergeCrateSources(files);
const position=unit.source.indexOf("util_fn();");
const original=ModuleAssembler.originalForOffset(unit,position);
assert.equal(original.path,"src/main.rs");
assert.equal(files[original.path].slice(original.offset,original.offset+7),"util_fn");
});
test("Module resolution rejects missing files",()=>assert.throws(()=>mergeCrateSources({"src/main.rs":"mod missing;"}),/Missing Rust module/));
test("Cargo metadata with no external dependencies compiles",()=>{
const result=compileProject({"Cargo.toml":'[package]\nname="abc"\nversion="0.1.0"\n[features]\ndefault=["std"]',"src/main.rs":'fn main(){println!("ok");}'});
assert.equal(result.plan.manifest.package.name,"abc");
});
