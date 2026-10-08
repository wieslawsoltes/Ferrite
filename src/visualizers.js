// Structured, clickable compiler representations: source coordinates drive selection.
export function createVisualizer(root,onSelect){
 let selected=null;
 const locate=(value,fallback)=>value?.loc??(Number.isInteger(value?.line)?{line:value.line,column:value.column??1,offset:value.offset}:null)??fallback??null;
 function label(node,key){if(node===null)return key+": null";if(typeof node!=="object")return key?key+": "+String(node):String(node);
  if(Array.isArray(node))return key+" ["+node.length+"]";
  const name=node.kind||node.name||node.key||node.instance||node.value;
  return key?(key+": "+(name||"object")):(name||"object");
 }
 function build(node,key="",depth=0,fallback=null) {
  const line=document.createElement("div");line.className="viz-line";line.style.paddingLeft=(depth*13)+"px";
  const loc=locate(node,fallback);line.dataset.line=loc?.line||"";line.dataset.column=loc?.column||1;
  if(depth>16){line.textContent="…";return line;}
  const summary=document.createElement("button");summary.type="button";summary.className="viz-node";
  summary.textContent=label(node,key);line.append(summary);
  if(loc){summary.title="Jump to source "+loc.line+":"+loc.column;summary.onclick=e=>{e.stopPropagation();select(loc);onSelect(loc);};}
  if(node&&typeof node==="object"&&depth<16){
   const entries=Array.isArray(node)?node.map((v,i)=>[String(i),v]):Object.entries(node).filter(([k])=>k!=="loc"&&k!=="fn");
   if(entries.length){
    const children=document.createElement("div");children.className="viz-children";
    for(const [k,v] of entries)children.append(build(v,k,depth+1,loc));
    line.append(children);
    summary.ondblclick=()=>{children.hidden=!children.hidden;};
   }
  }
  return line;
 }
 function select(loc) {
  if(selected)selected.classList.remove("source-selected");
  if(!loc)return;
  const items=[...root.querySelectorAll(".viz-line")].filter(x=>Number(x.dataset.line)===loc.line);
  selected=items.at(-1)||null;if(selected){selected.classList.add("source-selected");selected.scrollIntoView({block:"nearest"});}
 }
 return {render(value){root.replaceChildren(build(value));selected=null;},select};
}
export function renderCfg(root,mir,onSelect){
 root.replaceChildren();
 for(const fn of mir){
  const section=document.createElement("section");section.className="cfg-function";
  const title=document.createElement("strong");title.textContent=fn.instance;section.append(title);
  for(const block of fn.blocks){
   const el=document.createElement("button");el.className="cfg-block";el.type="button";
   const term=block.terminator;el.textContent=block.id+" · "+(block.instructions??block.statements).length+" stmt · "+(term?.kind||"end");
   const loc=(block.instructions??block.statements).find(x=>x.loc)?.loc||term?.condition?.loc||(block.span?{file:block.span.file,line:block.span.line,column:block.span.column,offset:block.span.start}:null);
   if(loc)el.onclick=()=>onSelect(loc);
   section.append(el);
   if(term?.kind==="switch"){const edge=document.createElement("div");edge.className="cfg-edge";edge.textContent="↳ true: "+term.true+" · false: "+term.false;section.append(edge);}
   if(term?.kind==="goto"){const edge=document.createElement("div");edge.className="cfg-edge";edge.textContent="↳ "+term.target;section.append(edge);}
  }
  root.append(section);
 }
}
export function renderInstances(root,instances,onSelect){
 root.replaceChildren();
 for(const item of instances){const el=document.createElement("button");el.type="button";el.className="instance-card";const k=document.createElement("strong");k.textContent=item.key;const p=document.createElement("small");p.textContent="→ "+item.returnType+" · "+JSON.stringify(item.typeArguments);el.append(k,p);if(item.loc)el.onclick=()=>onSelect(item.loc);root.append(el);}
}
