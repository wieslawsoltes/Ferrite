import {Dom} from './Dom.js';
import {ContextMenu} from './ContextMenu.js';
export class TabStrip {
  constructor(root,model,{onSplit = () => {}, onReveal = () => {}} = {}) { this.root=root; this.model=model; this.onSplit=onSplit; this.onReveal=onReveal; }
  menu(path) {
    const model=this.model;
    return [
      {label:model.pinned.has(path)?'Unpin tab':'Pin tab',execute:()=>model.pin(path)},
      {label:'Keep tab open',execute:()=>model.open(path)}, null,
      {label:'Split Right',execute:()=>this.onSplit(path,'right')}, {label:'Split Down',execute:()=>this.onSplit(path,'down')},
      {label:'Reveal in Project',execute:()=>this.onReveal(path)}, null,
      {label:'Close',execute:()=>model.close(path),shortcut:'Ctrl/Cmd+W'},
      {label:'Close Others',execute:()=>model.closeTabs('others',path)}, {label:'Close Tabs to the Right',execute:()=>model.closeTabs('right',path)},
      {label:'Close All Unpinned',execute:()=>model.closeTabs('all')}, {label:'Reopen Closed Tab',execute:()=>model.reopenClosed(),disabled:!model.closedTabs.length}
    ];
  }
  render() {
    const focused=this.root.contains(document.activeElement)?document.activeElement.dataset.file:null;
    this.root.replaceChildren();
    const counts=new Map(); for (const path of this.model.tabs) { const name=path.split('/').at(-1); counts.set(name,(counts.get(name)??0)+1); }
    for (const path of this.model.tabs) {
      const active=this.model.active===path, tab=Dom.element('div','document-tab'); tab.classList.toggle('active',active); tab.classList.toggle('preview-tab',this.model.previewTab===path);
      const name=path.split('/').at(-1), title=counts.get(name)>1?path:name;
      const button=Dom.button((this.model.pinned.has(path)?'◆ ':'')+title,()=>this.model.open(path),{icon:path.endsWith('.ui.rs')?'fit':path.endsWith('.toml')?'cargo':'file'});
      button.title=path; button.dataset.file=path; button.setAttribute('role','tab'); button.setAttribute('aria-selected',String(active)); button.tabIndex=active?0:-1;
      button.ondblclick=()=>this.model.open(path); button.onkeydown=event=>{
        const index=this.model.tabs.indexOf(path);
        if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const next=event.key==='Home'?0:event.key==='End'?this.model.tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+this.model.tabs.length)%this.model.tabs.length; this.model.open(this.model.tabs[next]); this.root.querySelector('[aria-selected=true]')?.focus(); }
        else if(event.key==='Delete'){event.preventDefault();this.model.close(path);}
      };
      tab.append(button); if(this.model.dirty(path))tab.append(Dom.element('span','dirty-dot','•'));
      tab.append(Dom.button('',()=>this.model.close(path),{icon:'close',className:'icon-button tab-close',title:`Close ${path}`}));
      tab.onauxclick=event=>{if(event.button===1){event.preventDefault();this.model.close(path);}};
      tab.oncontextmenu=event=>{event.preventDefault();ContextMenu.open(this.menu(path),{x:event.clientX,y:event.clientY,anchor:button});};
      tab.draggable=true; tab.ondragstart=event=>event.dataTransfer.setData('application/x-ferrite-tab',path);
      tab.ondragover=event=>{if(event.dataTransfer.types.includes('application/x-ferrite-tab'))event.preventDefault();};
      tab.ondrop=event=>{event.preventDefault();this.model.reorderTab(event.dataTransfer.getData('application/x-ferrite-tab'),path);};
      this.root.append(tab);
    }
    if(focused)this.root.querySelector(`[data-file="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    this.root.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
}
