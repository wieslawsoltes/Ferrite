/** Builds a call graph from independent monomorphized instance records. */
export class CallGraphBuilder {
 static build(ast,instances) {
  const nodes=instances.map(x=>({id:x.key,label:x.key,loc:x.loc??null}));
  const edges=[];
  for(const instance of instances)for(const call of instance.calls||[])
   edges.push({from:instance.key,to:call.to,loc:call.loc});
  return {nodes,edges,roots:["main<>"]};
 }
}
