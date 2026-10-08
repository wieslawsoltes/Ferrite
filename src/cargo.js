import {TomlParser} from "./cargo/TomlParser.js";
import {ModuleAssembler} from "./cargo/ModuleAssembler.js";
// Browser-side Cargo workspace model. Cargo.toml parsing is intentionally a supported subset.
export const starterFiles = {
"Cargo.toml": '[package]\nname = "ferrite-demo"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
"src/main.rs": 'fn greet<T: Display>(value: T) { println!("Hello, {}!", value); }\nfn main() { greet("Ferrite"); greet(42u32); }\n',
"src/math.rs": 'pub fn square(x: u32) -> u32 { x * x }\n'
};
export function parseManifest(source){return new TomlParser().parse(source);}
export function cargoPlan(files,command="check"){
 const manifest=parseManifest(files["Cargo.toml"]??"");
 const errors=[...manifest.errors];
 if(!manifest.package.name)errors.push({message:"Cargo.toml requires [package].name"});
 const main=files["src/main.rs"],lib=files["src/lib.rs"];
 if(!main&&!lib)errors.push({message:"Expected src/main.rs or src/lib.rs"});
 const unsupported=Object.keys(manifest.dependencies);
 return {command,manifest,entry:main?"src/main.rs":"src/lib.rs",files:Object.keys(files),dependencies:unsupported,
  warnings:unsupported.length?[ "Browser subset cannot resolve or download external Cargo dependencies: "+unsupported.join(", ") ]:[],
  errors};
}
export function mergeCrateSources(files,entry="src/main.rs"){return new ModuleAssembler(files).assemble(entry);}
export function createProject(files=starterFiles){return structuredClone(files);}
