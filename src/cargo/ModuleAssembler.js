/**
 * Assembles the supported subset of external Rust modules and keeps an exact
 * offset map from merged source back to the original virtual project files.
 * This is not rustc module name resolution.
 */
export class ModuleAssembler {
  constructor(files) { this.files=files; this.modules=[]; this.seen=new Set(); this.active=new Set(); this.parts=[]; this.sourceMap=[]; this.length=0; }
  append(path,text,originalOffset) {
    if(text.length===0)return;
    if(this.length>0){this.parts.push("\n");this.length++;}
    this.sourceMap.push({path,start:this.length,originalOffset,length:text.length});
    this.parts.push(text);this.length+=text.length;
  }
  visit(path) {
    if(this.active.has(path))throw Error("Cyclic module declaration: "+[...this.active,path].join(" -> "));
    if(this.seen.has(path))return;
    const source=this.files[path];if(typeof source!=="string")throw Error("Missing Rust module "+path);
    this.seen.add(path);this.active.add(path);this.modules.push(path);
    let cursor=0;const pattern=/\b(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/g;
    for(const match of source.matchAll(pattern)){
      const pos=match.index;
      this.append(path,source.slice(cursor,pos),cursor);
      const dirname=path.slice(0,path.lastIndexOf("/")+1);
      const direct=dirname+match[1]+".rs",nested=dirname+match[1]+"/mod.rs";
      const next=Object.hasOwn(this.files,direct)?direct:nested;
      this.visit(next);
      cursor=pos+match[0].length;
    }
    this.append(path,source.slice(cursor),cursor);
    this.active.delete(path);
  }
  assemble(entry="src/main.rs") {
    this.visit(entry);
    return {source:this.parts.join(""),modules:[...this.modules],sourceMap:this.sourceMap};
  }
  static originalForOffset(unit,offset) {
    const segment=unit.sourceMap.find(x=>offset>=x.start&&offset<x.start+x.length);
    if(!segment)return null;
    return {path:segment.path,offset:segment.originalOffset+offset-segment.start};
  }
}
