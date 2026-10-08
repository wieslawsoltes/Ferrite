import {Dom} from './Dom.js';
import {IrFormatter as F} from './IrFormatter.js';

/** SVG edges + accessible HTML nodes share a zoomable coordinate system. */
export class GraphView {
  constructor(root,registry){this.root=root;this.registry=registry;this.zoom=1;this.expanded=new Set();}
  renderCfg(fn){
    if(!fn){Dom.empty(this.root,'No function is available.');return;}
    const nodes=fn.blocks.map(block=>({id:block.id,title:`${block.id}  ${block.label??''}`,span:block.span,
      lines:[...block.instructions.map(i=>({text:F.instruction(i),span:i.span,id:i.id})),{text:F.terminator(block.terminator),span:block.terminator.span,terminator:true}],badge:`${block.instructions.length} ops`}));
    const edges=fn.blocks.flatMap(block=>{const t=block.terminator;return t.kind==='goto'?[{from:block.id,to:t.target,label:''}]:t.true?[{from:block.id,to:t.true,label:'true'},{from:block.id,to:t.false,label:'false'}]:[];});
    this.render(nodes,edges,fn.entry);
  }
  renderCallGraph(graph){const nodes=graph.nodes.map(n=>({id:n.id,title:n.label,span:n.span??this.span(n.loc),lines:[],badge:'instance'}));const edges=graph.edges.map(e=>({...e,span:e.span??this.span(e.loc),label:'call'}));this.render(nodes,edges,graph.roots[0]);}
  span(loc){return loc&&Number.isInteger(loc.offset)?{file:loc.file,start:loc.offset,end:loc.end??loc.offset+1,line:loc.line,column:loc.column}:null;}
  render(nodes,edges,entry){
    this.root.replaceChildren();this.zoom=1;
    if(!nodes.length){Dom.empty(this.root,'No reachable graph nodes.');return;}
    const controls=Dom.element('div','graph-controls');this.zoomLabel=Dom.element('span','zoom-label','100%');controls.append(Dom.button('',()=>this.scale(this.zoom/1.2),{icon:'minus',className:'icon-button',title:'Zoom out'}),this.zoomLabel,Dom.button('',()=>this.scale(this.zoom*1.2),{icon:'plus',className:'icon-button',title:'Zoom in'}),Dom.button('Fit',()=>this.fit(),{icon:'fit'}));
    this.viewport=Dom.element('div','graph-viewport');this.space=Dom.element('div','graph-space');this.canvas=Dom.element('div','graph-canvas');this.space.append(this.canvas);this.viewport.append(this.space);this.root.append(controls,this.viewport);
    let pan=null;this.viewport.addEventListener('pointerdown',e=>{if(e.target!==this.viewport&&e.target!==this.space&&e.target!==this.canvas)return;pan={x:e.clientX,y:e.clientY,left:this.viewport.scrollLeft,top:this.viewport.scrollTop};this.viewport.setPointerCapture(e.pointerId);});this.viewport.addEventListener('pointermove',e=>{if(pan){this.viewport.scrollLeft=pan.left+pan.x-e.clientX;this.viewport.scrollTop=pan.top+pan.y-e.clientY;}});for(const name of ['pointerup','pointercancel'])this.viewport.addEventListener(name,()=>{pan=null;});
    this.viewport.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();this.scale(this.zoom*(e.deltaY>0?1/1.1:1.1));}},{passive:false});
    const visible=nodes.slice(0,150),byId=new Map(visible.map(n=>[n.id,n])),rank=new Map([[entry,0]]),queue=[entry];
    for(let k=0;k<queue.length;k++){for(const edge of edges.filter(e=>e.from===queue[k]))if(byId.has(edge.to)&&!rank.has(edge.to)){rank.set(edge.to,rank.get(edge.from)+1);queue.push(edge.to);}}
    for(const node of visible)if(!rank.has(node.id))rank.set(node.id,Math.max(0,...rank.values())+1);
    const levels=new Map();for(const node of visible){const r=rank.get(node.id);if(!levels.has(r))levels.set(r,[]);levels.get(r).push(node);}
    const positions=new Map();let y=28,maxWidth=0;
    for(const group of levels.values()){
      let x=28,height=0;
      for(const node of group){const shown=node.lines.length>12&&!this.expanded.has(node.id)?node.lines.slice(0,10):node.lines;const h=62+(shown.length+(shown.length<node.lines.length?1:0))*23;
        positions.set(node.id,{x,y,w:330,h});x+=370;height=Math.max(height,h);const card=Dom.element('section','graph-node');card.style.cssText=`left:${positions.get(node.id).x}px;top:${y}px;width:330px;height:${h}px`;card.dataset.node=node.id;
        const header=Dom.element('div','graph-node-title');header.append(Dom.element('strong','',node.title),Dom.element('span','graph-badge',node.badge??''));card.append(header);this.registry.bind(header,node.span);
        const content=Dom.element('div','graph-instructions');for(const line of shown){const row=Dom.element('button','ir-line',line.text);row.type='button';row.classList.toggle('terminator',!!line.terminator);if(line.id)row.dataset.instruction=line.id;this.registry.bind(row,line.span);content.append(row);}
        if(shown.length<node.lines.length){const more=Dom.button(`Show ${node.lines.length-shown.length} more instructions`,()=>{const z=this.zoom;this.expanded.add(node.id);this.registry.clear();this.render(nodes,edges,entry);this.scale(z);},{className:'show-more'});content.append(more);}card.append(content);this.canvas.append(card);
      }maxWidth=Math.max(maxWidth,x);y+=height+78;
    }
    this.width=maxWidth+90;this.height=y+10;this.canvas.style.width=this.width+'px';this.canvas.style.height=this.height+'px';
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('graph-edges');svg.setAttribute('width',String(this.width));svg.setAttribute('height',String(this.height));
    const defs=document.createElementNS(ns,'defs');defs.innerHTML='<marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#6b9ed9"/></marker>';svg.append(defs);
    edges.forEach((edge,index)=>{const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)return;const path=document.createElementNS(ns,'path');let d,lx,ly;
      if(b.y>a.y){const x1=a.x+a.w/2,x2=b.x+b.w/2,y1=a.y+a.h,y2=b.y;d=`M${x1} ${y1} C${x1} ${y1+42},${x2} ${y2-42},${x2} ${y2}`;lx=(x1+x2)/2+7;ly=(y1+y2)/2;}
      else{const x=this.width-30-(index%4)*13;d=`M${a.x+a.w} ${a.y+a.h/2} C${x} ${a.y+a.h/2},${x} ${b.y+b.h/2},${b.x+b.w} ${b.y+b.h/2}`;lx=x-30;ly=(a.y+b.y)/2+25;}
      path.setAttribute('d',d);path.setAttribute('marker-end','url(#graph-arrow)');path.classList.add('graph-edge');svg.append(path);if(edge.span)this.registry.bind(path,edge.span);
      if(edge.label){const text=document.createElementNS(ns,'text');text.setAttribute('x',String(lx));text.setAttribute('y',String(ly));text.textContent=edge.label;svg.append(text);}
    });this.canvas.prepend(svg);this.scale(1);if(nodes.length>150)this.root.prepend(Dom.element('p','view-note','Showing the first 150 nodes. Select a smaller function.'));
  }
  scale(value){this.zoom=Math.max(.25,Math.min(2.5,value));this.canvas.style.transform=`scale(${this.zoom})`;this.space.style.width=this.width*this.zoom+'px';this.space.style.height=this.height*this.zoom+'px';this.zoomLabel.textContent=Math.round(this.zoom*100)+'%';}
  fit(){const width=this.viewport.clientWidth-20;this.scale(Math.min(1,width/this.width));this.viewport.scrollTop=0;this.viewport.scrollLeft=0;}
}
