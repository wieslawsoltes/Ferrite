/** Small display parser for actual rustc MIR / LLVM labels. Not a compiler or semantic parser. */
export class NativeControlFlow {
  static parse(artifact){
    if(!['mir','llvm-ir'].includes(artifact.kind)||!artifact.content)return [];
    const mappings=new Map((artifact.mappings??[]).map(m=>[m.line,m.span]));const functions=[];let fn=null,block=null;
    const nextBlock=(id,line)=>{block={id,title:id,span:mappings.get(line),lines:[]};fn.nodes.push(block);};
    artifact.content.split('\n').forEach((text,index)=>{
      const line=index+1,start=artifact.kind==='mir'?/^fn\s+(.+?)\s*\{\s*$/.exec(text):/^define\b.*?@("[^"]+"|[^\s(]+)\(/.exec(text);
      if(start){fn={name:start[1],nodes:[],edges:[]};functions.push(fn);block=null;return;}
      if(!fn)return;
      if(/^}\s*$/.test(text)){fn=null;block=null;return;}
      const label=artifact.kind==='mir'?/^\s*(bb\d+)(?:\s*\(cleanup\))?:\s*\{/.exec(text):/^([-A-Za-z$._0-9]+):/.exec(text);
      if(label){nextBlock(label[1],line);return;}
      if(artifact.kind==='llvm-ir'&&!block&&/^\s+\S/.test(text)&&!text.trim().startsWith(';'))nextBlock('entry',line);
      if(!block)return;
      if(text.trim()&&text.trim()!=='}')block.lines.push({text:text.trim(),span:mappings.get(line)});
      const targets=artifact.kind==='mir'?(text.includes('->')?[...text.matchAll(/\bbb\d+\b/g)].map(m=>m[0]):[]):[...text.matchAll(/label\s+%([-A-Za-z$._0-9]+)/g)].map(m=>m[1]);
      for(const target of targets)if(!fn.edges.some(e=>e.from===block.id&&e.to===target))fn.edges.push({from:block.id,to:target,label:''});
    });
    return functions.filter(f=>f.nodes.length).map(f=>({...f,entry:f.nodes[0].id,edges:f.edges.filter(e=>f.nodes.some(n=>n.id===e.to))}));
  }
}
