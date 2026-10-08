import {Dom} from './Dom.js';
/** Lazy AST/HIR hierarchy; expands only visible branches and preserves source identities. */
export class TreeView {
  constructor(root,registry){this.root=root;this.registry=registry;this.count=0;}
  render(value){this.root.replaceChildren();this.count=0;this.root.append(this.node(value,'crate',0));}
  label(value,key){if(Array.isArray(value))return `${key} · ${value.length}`;if(value&&typeof value==='object'){const kind=value.kind??key;const name=value.instance??value.name??value.op??value.intrinsic??'';const type=typeof value.type==='string'?` : ${value.type}`:'';return `${kind} ${name}${type}`.trim();}return `${key} = ${String(value)}`;}
  node(value,key,depth){
    if(++this.count>8000)return Dom.element('div','empty-state','Expand a smaller branch to inspect more nodes.');
    if(!value||typeof value!=='object')return Dom.element('div','tree-scalar',this.label(value,key));
    const details=Dom.element('details','ast-node'),summary=Dom.element('summary','ast-label');summary.append(Dom.element('span','node-kind',Array.isArray(value)?'[]':value.kind?.slice(0,2)??'{}'),Dom.element('span','',this.label(value,key)));details.append(summary);this.registry.bind(summary,value.span);
    const entries=Object.entries(value).filter(([name,v])=>!['span','loc','id','sourceId','binding','resolution','method','call','constant','typeArguments'].includes(name)&&name!=='kind'&&name!=='name'&&name!=='type'&&v!==null&&v!==undefined);
    let built=false;const fill=()=>{if(built)return;built=true;const body=Dom.element('div','ast-children');for(const [k,v] of entries)body.append(this.node(v,k,depth+1));details.append(body);};
    details.addEventListener('toggle',()=>{if(details.open){fill();this.registry.highlight(this.registry.selection.value);}});
    if(depth<3){details.open=true;fill();}return details;
  }
}
