/** Extracts the resolved, monomorphized call graph from a typed AST. */
export class CallGraphBuilder {
  static build(ast,instances) {
    const nodes=instances.map(x=>({id:x.key,label:x.key,loc:x.loc??null}));
    const edges=[];const byName=new Map(ast.items.filter(x=>x.kind==="fn").map(x=>[x.name,x]));
    const walk=(node,owner)=>{
      if(!node||typeof node!=="object")return;
      if(node.kind==="call"&&!node.macro&&node.resolved)edges.push({from:owner,to:node.resolved,loc:node.loc});
      if(Array.isArray(node)){for(const x of node)walk(x,owner);return;}
      for(const [key,value] of Object.entries(node))if(key!=="loc"&&key!=="resolved")walk(value,owner);
    };
    for(const instance of instances){const fn=byName.get(instance.name);if(fn)walk(fn.body,instance.key);}
    return {nodes,edges,roots:["main<>"]};
  }
}
