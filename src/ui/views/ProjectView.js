import {Dom} from './Dom.js';
import {ContextMenu} from './ContextMenu.js';
import {WorkspaceTree} from '../model/WorkspaceTree.js';
/** Hierarchy, selection, expansion and keyboard focus are independent from document activation. */
export class ProjectView {
  constructor(root,model,{actions=null}={}) {
    this.root=root; this.model=model; this.actions=actions; this.collapsed=new Set(); this.filter=''; this.selected=null;
    root.setAttribute('role','tree'); root.setAttribute('aria-label','Project files'); root.tabIndex=0;
    root.oncontextmenu=event=>{if(event.target===root){event.preventDefault();this.context('',event);}};
    root.onkeydown=event=>this.keydown(event);
  }
  get directory() { const path=this.selected??this.model.active??''; return this.model.folders.has(path)?path:path.includes('/')?path.slice(0,path.lastIndexOf('/')):''; }
  reveal(path=this.model.active) {
    if(!path)return; this.selected=path; for(const folder of this.model.folders)if(WorkspaceTree.contains(folder,path))this.collapsed.delete(folder);
    this.filter=''; this.render(); this.root.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({block:'nearest'});
  }
  context(path,event) {
    this.selected=path; this.render(); const button=this.root.querySelector(`[data-path="${CSS.escape(path)}"]`)??this.root;
    ContextMenu.open(this.actions?.menu(path)??[],{x:event.clientX,y:event.clientY,anchor:button,onError:error=>this.actions?.error(error)});
  }
  keydown(event) {
    const row=event.target.closest('[data-path]'),rows=[...this.root.querySelectorAll('[data-path]')]; if(!row)return;
    const path=row.dataset.path,index=rows.indexOf(row),folder=this.model.folders.has(path);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)));this.selected=rows[next].dataset.path;rows[next].focus();}
    else if(event.key==='ArrowRight'&&folder){event.preventDefault();if(this.collapsed.delete(path))this.render();else rows[index+1]?.focus();}
    else if(event.key==='ArrowLeft'){event.preventDefault();if(folder&&!this.collapsed.has(path)){this.collapsed.add(path);this.render();}else this.root.querySelector(`[data-path="${CSS.escape(path.slice(0,path.lastIndexOf('/')))}"]`)?.focus();}
    else if(event.key==='Enter'&&!folder&&event.shiftKey){event.preventDefault();this.actions?.split(path);}
    else if(event.key==='F2'){event.preventDefault();this.actions?.rename(path);}
    else if(event.key==='Delete'){event.preventDefault();this.actions?.remove(path);}
  }
  render() {
    const focus=this.root.contains(document.activeElement)?document.activeElement.dataset.path:null, query=this.filter.toLowerCase();
    const tree={folders:new Map(),files:[]};
    const addFolder=path=>{let parent=tree;for(const part of path.split('/').filter(Boolean)){if(!parent.folders.has(part))parent.folders.set(part,{folders:new Map(),files:[]});parent=parent.folders.get(part);}return parent;};
    for(const path of [...this.model.folders].sort())if(!query||path.toLowerCase().includes(query))addFolder(path);
    for(const path of Object.keys(this.model.files).sort()){if(query&&!path.toLowerCase().includes(query))continue;const parts=path.split('/');addFolder(parts.slice(0,-1).join('/')).files.push({path,name:parts.at(-1)});}
    const fragment=document.createDocumentFragment();
    const attach=(button,path,depth,folder)=>{
      button.dataset.path=path; button.setAttribute('role','treeitem'); button.setAttribute('aria-level',String(depth+1)); button.setAttribute('aria-selected',String((this.selected??this.model.active)===path));
      button.tabIndex=(this.selected??this.model.active)===path?0:-1; button.onfocus=()=>{this.selected=path;for(const row of this.root.querySelectorAll('[data-path]')){row.tabIndex=row===button?0:-1;row.setAttribute('aria-selected',String(row===button));}};
      button.title=path; button.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();this.context(path,event);};
      button.draggable=true; button.ondragstart=event=>event.dataTransfer.setData('application/x-ferrite-project-path',path);
      if(folder){button.ondragover=event=>{if(event.dataTransfer.types.includes('application/x-ferrite-project-path'))event.preventDefault();};button.ondrop=event=>{event.preventDefault();const source=event.dataTransfer.getData('application/x-ferrite-project-path');this.actions?.move(source,path+'/'+source.split('/').at(-1));};}
      fragment.append(button);
    };
    const render=(node,depth,parentPath='')=>{
      for(const [name,children] of [...node.folders].sort(([a],[b])=>a.localeCompare(b))){const path=parentPath+name,closed=!query&&this.collapsed.has(path);const button=Dom.button(name,()=>{this.selected=path;closed?this.collapsed.delete(path):this.collapsed.add(path);this.render();},{icon:closed?'right':'down',className:'project-row folder-row'});button.prepend(Dom.icon('folder'));button.style.paddingLeft=`${10+depth*15}px`;button.setAttribute('aria-expanded',String(!closed));attach(button,path,depth,true);if(!closed)render(children,depth+1,path+'/');}
      for(const {path,name} of node.files){const button=Dom.button(name,()=>{this.selected=path;this.model.open(path,{preview:true});},{icon:path.endsWith('.ui.rs')?'fit':path.endsWith('.toml')?'cargo':'file',className:'project-row file-row'});button.dataset.file=path;button.style.paddingLeft=`${26+depth*15}px`;button.classList.toggle('active',this.model.active===path);button.ondblclick=()=>this.model.open(path);if(this.model.dirty(path))button.append(Dom.element('span','dirty-dot','•'));attach(button,path,depth,false);}
    };
    render(tree,0); this.root.replaceChildren(fragment);this.root.tabIndex=this.root.children.length?-1:0;
    if(!this.root.querySelector('[tabindex="0"]'))this.root.querySelector('[data-path]')?.setAttribute('tabindex','0');
    if(focus)this.root.querySelector(`[data-path="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
}
