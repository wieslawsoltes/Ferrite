/** Interactive call graph visualization. DOM-only; no dependencies. */
export class CallGraphView {
  constructor(root,onNavigate){this.root=root;this.onNavigate=onNavigate;}
  render(graph){
    this.root.replaceChildren();
    const stats=document.createElement("div");stats.className="graph-summary";stats.textContent=graph.nodes.length+" instances · "+graph.edges.length+" call sites";this.root.append(stats);
    const outgoing=new Map();
    for(const edge of graph.edges){const list=outgoing.get(edge.from)??[];list.push(edge);outgoing.set(edge.from,list);}
    for(const node of graph.nodes){
      const card=document.createElement("section");card.className="callgraph-card";
      const header=document.createElement("button");header.className="viz-node";header.textContent="ƒ  "+node.label;
      if(node.loc)header.onclick=()=>this.onNavigate(node.loc);
      card.append(header);
      for(const edge of outgoing.get(node.id)??[]){
        const link=document.createElement("button");link.className="callgraph-edge";link.textContent="↳  "+edge.to;
        link.title="Jump to call site";if(edge.loc)link.onclick=()=>this.onNavigate(edge.loc);
        card.append(link);
      }
      this.root.append(card);
    }
  }
}
