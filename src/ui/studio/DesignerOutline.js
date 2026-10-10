import {Dom} from '../views/Dom.js';
import {insertElement} from './DesignerView.js';

export function renderDesignerOutline(s) {
  s.outline.replaceChildren();if(!s.designer)return;s.outlineCollapsed??=new Set();
  const query=(s.outlineSearch?.value??'').trim().toLowerCase(),included=new Set();
  if(query)for(const node of s.designer.nodes){
    const label=`${node.tag??''} ${node.value??''} ${(node.attributes??[]).map(a=>`${a.name} ${a.value??''}`).join(' ')}`.toLowerCase();
    if(!label.includes(query))continue;
    for(let current=node;current;current=s.designer.parents.get(current.id))included.add(current.id);
  }
  const visible=[];
  const render=(node,depth=0)=>{
    if(query&&!included.has(node.id))return;visible.push(node);
    const label=node.kind==='element'?`<${node.tag??'Fragment'}>`:node.kind==='text'?node.value.slice(0,80):'{ Rust expression }';
    const row=Dom.element('div','studio-outline-row');row.dataset.sourceNode=node.id;row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(depth+1));row.setAttribute('aria-selected',String(node.id===s.selected));row.tabIndex=node.id===s.selected?0:-1;row.title=`${label} · line ${node.span.line}`;
    row.style.paddingLeft=`${4+depth*12}px`;const children=(node.children?.length??0)>0,collapsed=!query&&s.outlineCollapsed.has(node.id);
    if(children){row.setAttribute('aria-expanded',String(!collapsed));const toggle=Dom.button('',null, {icon:collapsed?'right':'down',className:'studio-tree-toggle',title:`${collapsed?'Expand':'Collapse'} ${label}`});toggle.tabIndex=-1;toggle.setAttribute('aria-label',toggle.title);toggle.onclick=event=>{event.stopPropagation();collapsed?s.outlineCollapsed.delete(node.id):s.outlineCollapsed.add(node.id);s.renderOutline();s.outline.querySelector(`[data-source-node="${node.id}"]`)?.focus();};row.append(toggle);}
    else row.append(Dom.element('span','studio-tree-spacer'));
    row.append(Dom.element('span','studio-outline-label',label),Dom.element('span','studio-outline-line',String(node.span.line)));
    row.onclick=()=>{Promise.resolve().then(()=>s.select(node.id)).catch(error=>s.error(error));};
    row.onkeydown=event=>{
      if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();
      let target=node;
      if(event.key==='ArrowRight'){s.outlineCollapsed.delete(node.id);s.renderOutline();target=node.children?.[0]??node;}
      else if(event.key==='ArrowLeft'){if(children&&!collapsed){s.outlineCollapsed.add(node.id);s.renderOutline();}else target=s.designer.parents.get(node.id)??node;}
      else if(event.key==='Home')target=visible[0];else if(event.key==='End')target=visible.at(-1);
      else if(['ArrowDown','ArrowUp'].includes(event.key))target=visible[Math.max(0,Math.min(visible.length-1,visible.indexOf(node)+(event.key==='ArrowDown'?1:-1)))];
      try{s.select(target.id);s.outline.querySelector(`[data-source-node="${target.id}"]`)?.focus();}catch(error){s.error(error);}
    };
    row.draggable=s.designer.parents.has(node.id);row.ondragstart=event=>{event.dataTransfer.setData('application/x-ferrite-ui-node',JSON.stringify({id:node.id,file:s.file,revision:s.model.revision}));};
    row.ondragover=event=>{if(node.kind==='element'&&['application/x-ferrite-ui-node','application/x-ferrite-ui-markup'].some(type=>event.dataTransfer.types.includes(type))){event.preventDefault();row.classList.add('studio-outline-drop');}};
    row.ondragleave=()=>row.classList.remove('studio-outline-drop');
    row.ondrop=event=>{
      event.preventDefault();event.stopPropagation();row.classList.remove('studio-outline-drop');
      try{const markup=event.dataTransfer.getData('application/x-ferrite-ui-markup');if(markup){insertElement(s,markup,node.id,'inside').catch(error=>s.error(error));return;}
        const value=JSON.parse(event.dataTransfer.getData('application/x-ferrite-ui-node'));if(value.revision!==s.model.revision||value.file!==s.file)throw Error('Drag source is stale or belongs to another file');s.edit({op:'move',node:value.id,parent:node.id}).catch(error=>s.error(error));
      }catch(error){s.error(error);}
    };
    s.outline.append(row);if(!collapsed)for(const child of node.children??[])render(child,depth+1);
  };
  for(const node of s.designer.nodes.filter(node=>!s.designer.parents.has(node.id)))render(node);
  if(!visible.length)s.outline.append(Dom.element('p','studio-hint','No matching source elements.'));
  if(s.breadcrumbs){
    const ancestors=[];for(let node=s.designer.index.get(s.selected);node;node=s.designer.parents.get(node.id))ancestors.unshift(node);
    s.breadcrumbs.replaceChildren();for(const node of ancestors){const button=s.button(node.tag??(node.kind==='text'?'Text':'Expression'),()=>s.select(node.id));button.title=`Select ${node.tag??node.kind} at line ${node.span.line}`;button.setAttribute('aria-current',node.id===s.selected?'true':'false');s.breadcrumbs.append(button);}
  }
}
