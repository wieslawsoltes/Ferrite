import {Dom} from './Dom.js';
/** Hierarchical files, with folder expansion independent from model edits. */
export class ProjectView {
  constructor(root, model){this.root=root;this.model=model;this.collapsed=new Set();this.filter='';}
  render(){
    const tree={folders:new Map(),files:[]};
    for(const path of Object.keys(this.model.files).sort()){if(this.filter&&!path.toLowerCase().includes(this.filter.toLowerCase()))continue;const parts=path.split('/');let parent=tree;for(const part of parts.slice(0,-1)){if(!parent.folders.has(part))parent.folders.set(part,{folders:new Map(),files:[]});parent=parent.folders.get(part);}parent.files.push({path,name:parts.at(-1)});}
    const fragment=document.createDocumentFragment();
    const render=(node,depth,parentPath='')=>{
      for(const [name,children] of node.folders){const path=parentPath+name,closed=this.collapsed.has(path);const button=Dom.button(name,()=>{closed?this.collapsed.delete(path):this.collapsed.add(path);this.render();},{icon:closed?'right':'down',className:'project-row folder-row'});button.prepend(Dom.icon('folder'));button.style.paddingLeft=`${10+depth*15}px`;button.setAttribute('aria-expanded',String(!closed));fragment.append(button);if(!closed)render(children,depth+1,path+'/');}
      for(const {path,name} of node.files){const button=Dom.button(name,()=>this.model.open(path),{icon:path.endsWith('.toml')?'cargo':'file',className:'project-row file-row'});button.title=path;button.dataset.file=path;button.style.paddingLeft=`${26+depth*15}px`;button.classList.toggle('active',this.model.active===path);if(this.model.dirty(path))button.append(Dom.element('span','dirty-dot','•'));fragment.append(button);}
    };render(tree,0);this.root.replaceChildren(fragment);
  }
}
