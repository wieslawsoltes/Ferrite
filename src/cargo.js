// Browser-side Cargo workspace model. Cargo.toml parsing is intentionally a supported subset.
export const starterFiles = {
"Cargo.toml": '[package]\nname = "ferrite-demo"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
"src/main.rs": 'fn greet<T: Display>(value: T) { println!("Hello, {}!", value); }\nfn main() { greet("Ferrite"); greet(42u32); }\n',
"src/math.rs": 'pub fn square(x: u32) -> u32 { x * x }\n'
};
export function parseManifest(source) {
 const sections={}, errors=[];let section="";
 for(const [index,line] of source.split(/\r?\n/).entries()){
  const text=line.trim();if(!text||text.startsWith("#"))continue;
  const heading=/^\[([A-Za-z0-9_.-]+)\]$/.exec(text);
  if(heading){section=heading[1];sections[section]??={};continue;}
  const assignment=/^([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(text);
  if(!assignment){errors.push({line:index+1,message:"Unsupported TOML syntax"});continue;}
  const [,key,raw]=assignment;let value;
  if(/^"(?:\\.|[^"\\])*"$/.test(raw)){try{value=JSON.parse(raw);}catch{errors.push({line:index+1,message:"Invalid string"});continue;}}
  else if(/^(true|false)$/.test(raw))value=raw==="true";
  else if(/^\d+$/.test(raw))value=Number(raw);
  else value=raw;
  (sections[section]??={})[key]=value;
 }
 return {package:sections.package??{},dependencies:sections.dependencies??{},sections,errors};
}
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
export function mergeCrateSources(files,entry="src/main.rs"){
 const seen=new Set(),segments=[],map=[];
 function visit(path) {
  if(seen.has(path))return;seen.add(path);
  const source=files[path];if(typeof source!=="string")throw Error("Missing module "+path);
  let cursor=0;
  const pattern=/\b(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/g;
  let match;while((match=pattern.exec(source))){
   const before=source.slice(cursor,match.index);if(before.trim()){map.push({path,start:segments.join("\n").length,originalOffset:cursor,length:before.length});segments.push(before);}
   const dir=path.slice(0,path.lastIndexOf("/")+1);
   let target=dir+match[1]+".rs";
   if(!(target in files))target=dir+match[1]+"/mod.rs";
   visit(target);cursor=pattern.lastIndex;
  }
  const tail=source.slice(cursor);if(tail.trim()){map.push({path,start:segments.join("\n").length,originalOffset:cursor,length:tail.length});segments.push(tail);}
 }
 visit(entry);return {source:segments.join("\n"),modules:[...seen],sourceMap:map};
}
export function createProject(files=starterFiles){return structuredClone(files);}
