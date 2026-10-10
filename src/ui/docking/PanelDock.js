import {Dom} from '../views/Dom.js';
import {PanelLayout, clamp, clampBox} from './PanelLayout.js';

let nextWorkspace = 0;
/**
 * A retained panel surface over a split tree. Contents are mounted exactly once.
 * Floating promotes that SAME surface into the browser top layer, rather than
 * reparenting an iframe (which would destroy its document and application state).
 */
export class PanelDock {
  constructor(root, definitions, {initial, saved, onChange = () => {}, onError = () => {}, onReveal = () => {}, compactWidth = 600} = {}) {
    this.root=root;this.definitions=new Map(definitions.map(panel=>[panel.id,panel]));
    this.layout=new PanelLayout(this.definitions.keys(),initial,saved);this.onChange=onChange;this.onError=onError;this.onReveal=onReveal;
    this.compactWidth=compactWidth;this.visible=false;this.compactPanel='canvas';this.maximized=null;this.solo=null;
    this.panels=new Map();this.splitters=new Map();this.rectangles=[];this.abort=new AbortController();this.uid=`designer-dock-${++nextWorkspace}`;
    root.classList.add('panel-dock');root.setAttribute('aria-label','Designer docking workspace');
    this.empty=Dom.element('div','dock-empty','All panels are hidden. Open Panels to restore a panel or reset the layout.');root.append(this.empty);
    this.announcement=Dom.element('div','dock-announcement');this.announcement.setAttribute('role','status');root.append(this.announcement);
    for(const definition of definitions)this.mount(definition);
    this.menu=Dom.element('div','dock-menu');this.menu.setAttribute('popover','auto');this.menu.setAttribute('role','dialog');root.append(this.menu);
    this.menu.addEventListener('keydown',event=>this.menuKey(event),{signal:this.abort.signal});
    this.shield=Dom.element('div','dock-drag-shield');this.shield.setAttribute('popover','manual');
    this.guide=Dom.element('div','dock-drop-guide');this.shield.append(this.guide);root.append(this.shield);
    this.observer=new ResizeObserver(()=>this.schedule());this.observer.observe(root);
    window.addEventListener('resize',()=>this.schedule(),{signal:this.abort.signal});
    document.addEventListener('keydown',event=>{
      if(this.drag&&event.key==='Escape'){event.preventDefault();event.stopPropagation();this.finishDrag(true);}
    },{capture:true,signal:this.abort.signal});
    root.addEventListener('keydown',event=>this.workspaceKey(event),{signal:this.abort.signal});
  }
  mount(definition) {
    const {id,title,element}=definition,panel=Dom.element('section','dock-panel'),header=Dom.element('div','dock-panel-header'),tabs=Dom.element('div','dock-panel-tabs'),actions=Dom.element('div','dock-panel-actions');
    panel.id=`${this.uid}-${id}`;panel.dataset.dockPanel=id;panel.setAttribute('aria-label',`${title} panel`);panel.hidden=true;
    tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',`${title} group`);
    const more=Dom.button('',()=>this.panelMenu(id,more),{icon:'menu',className:'dock-icon',title:`${title} panel actions`});more.setAttribute('aria-label',`${title} panel actions`);more.setAttribute('aria-haspopup','dialog');
    const float=Dom.button('',()=>this.action(id,'float'),{icon:'split',className:'dock-icon',title:`Float ${title}`});float.setAttribute('aria-label',`Float ${title}`);
    const close=Dom.button('',()=>this.action(id,'close'),{icon:'close',className:'dock-icon',title:`Hide ${title}`});close.setAttribute('aria-label',`Hide ${title}`);
    actions.append(float,more,close);header.append(tabs,actions);
    const body=Dom.element('div','dock-panel-body');body.setAttribute('role','tabpanel');body.id=`${panel.id}-body`;body.append(element);
    const resize=Dom.button('',null,{icon:'grip',className:'dock-float-resize',title:`Resize floating ${title}`});resize.setAttribute('aria-label',`Resize floating ${title}`);
    resize.addEventListener('pointerdown',event=>this.beginDrag(event,{kind:'resize',id}));
    resize.addEventListener('keydown',event=>{
      if(!event.key.startsWith('Arrow'))return;event.preventDefault();event.stopPropagation();const box=this.layout.floating(id);if(!box)return;
      const step=event.shiftKey?40:10;this.layout.setBox(id,{width:box.width+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),height:box.height+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)});this.changed();
    });
    panel.append(header,body,resize);this.root.append(panel);this.panels.set(id,{panel,header,tabs,body,resize,float,more,close,signature:null});
    panel.addEventListener('pointermove',event=>this.dragMove(event));
    panel.addEventListener('pointerup',event=>{if(this.drag?.pointerId===event.pointerId)this.finishDrag(false,event);});
    panel.addEventListener('pointercancel',()=>this.finishDrag(true));
    panel.addEventListener('lostpointercapture',()=>{if(this.drag)this.finishDrag(true);});
    panel.addEventListener('contextmenu',event=>{if(event.target.closest('.dock-panel-header')){event.preventDefault();this.panelMenu(id,more);}});
  }
  title(id) { return this.definitions.get(id)?.title ?? id; }
  setPresentation({visible = true, solo = null} = {}) {
    this.visible=visible;this.solo=solo;
    if(!visible){this.finishDrag(true);this.closeMenu(false);for(const {panel} of this.panels.values())this.conceal(panel);}
    this.schedule();
  }
  snapshot() { return {layout:this.layout.snapshot(),maximized:this.maximized,compact:this.compact,activePanel:this.compactPanel}; }
  schedule() { if(this.disposed||this.pending)return;this.pending=requestAnimationFrame(()=>{this.pending=0;this.render();}); }
  changed(message = '') { this.render();this.onChange(this.layout.snapshot());if(message)this.announcement.textContent=message; }
  open(id) {
    this.onReveal(id);
    if(this.compact&&this.layout.visible(id)&&!this.maximized){this.compactPanel=id;this.render();this.focusPanel(id);return;}
    this.layout.open(id);this.compactPanel=id;if(this.maximized&&this.maximized!==id)this.maximized=null;
    this.changed(`${this.title(id)} opened`);this.focusPanel(id);
  }
  focusPanel(id) { this.panels.get(id)?.tabs.querySelector(`[data-panel-tab="${id}"]`)?.focus({preventScroll:true}); }
  action(id, action) {
    if(this.disposed)return;
    this.closeMenu(false);
    try {
      if(action==='close'){this.layout.close(id);if(this.maximized===id)this.maximized=null;if(this.compactPanel===id)this.compactPanel='canvas';}
      else if(action==='float'){
        this.maximized=null;const rect=this.panels.get(id).panel.getBoundingClientRect();
        if(this.layout.floating(id))this.layout.redock(id);
        else this.layout.float(id,clampBox({x:rect.x+24,y:rect.y+24,width:Math.max(300,rect.width),height:Math.max(280,rect.height)},innerWidth,innerHeight));
      } else if(action==='maximize') {this.maximized=this.maximized===id?null:id;this.layout.open(id);this.compactPanel=id;}
      else if(['left','right','top','bottom'].includes(action)){this.maximized=null;this.layout.dock(id,null,action);this.compactPanel=id;}
      this.changed(`${this.title(id)}: ${action}`);
      if(action==='close')this.focusPanel(this.rectangles[0]?.id);else this.focusPanel(id);
    }catch(error){this.onError(error);}
  }
  reset(initial) { this.finishDrag(true);this.closeMenu(false);this.maximized=null;this.compactPanel='canvas';this.layout.reset(initial);this.changed('Designer layout restored'); }
  render() {
    if(this.disposed)return;
    const width=this.root.clientWidth,height=this.root.clientHeight;
    if(!this.visible||!width||!height){for(const {panel} of this.panels.values())this.conceal(panel);return;}
    this.compact=width<this.compactWidth;this.root.dataset.compact=String(this.compact);
    const single=this.solo??this.maximized??(this.compact?(this.layout.visible(this.compactPanel)?this.compactPanel:[...this.definitions.keys()].find(id=>this.layout.visible(id))):null);
    this.root.dataset.solo=single??'';
    let {groups,splits}=this.layout.measure(width,height);
    if(single){groups=[{node:{id:'presentation',type:'group',tabs:[single],active:single},x:0,y:0,width,height}];splits=[];}
    const shown=new Set();this.rectangles=[];
    for(const rect of groups)this.place(rect,false,shown);
    if(!single)for(const box of this.layout.value.floating)this.place({...clampBox(box,innerWidth,innerHeight),node:box.node},true,shown);
    for(const [id,{panel}] of this.panels)if(!shown.has(id))this.conceal(panel);
    this.empty.hidden=shown.size>0;
    const splitIds=new Set(splits.map(split=>split.node.id));
    for(const split of splits)this.placeSplitter(split);
    for(const [id,element] of this.splitters)if(!splitIds.has(id)){element.remove();this.splitters.delete(id);}
  }
  place(rect, floating, shown) {
    const id=this.solo??this.layout.active(rect.node);if(!id)return;
    const view=this.panels.get(id);if(!view)return;shown.add(id);
    const {panel}=view;panel.hidden=false;panel.dataset.floating=String(floating);
    this.header(view,rect.node,id,floating);this.position(panel,rect);
    if(floating&&typeof panel.showPopover==='function'){
      if(panel.getAttribute('popover')!=='manual')panel.setAttribute('popover','manual');
      if(!panel.matches(':popover-open'))panel.showPopover();
    }else{this.hidePopover(panel);panel.removeAttribute('popover');}
    view.resize.hidden=!floating;view.float.title=floating?`Dock ${this.title(id)} back`:`Float ${this.title(id)}`;
    view.float.setAttribute('aria-label',view.float.title);
    this.rectangles.push({id,node:rect.node,floating,rect:floating?rect:{...rect,x:rect.x+this.root.getBoundingClientRect().x,y:rect.y+this.root.getBoundingClientRect().y}});
  }
  position(element, rect) { for(const [property,key] of [['left','x'],['top','y'],['width','width'],['height','height']])element.style[property]=`${Math.max(key==='width'||key==='height'?0:-10000,rect[key])}px`; }
  conceal(panel) { this.hidePopover(panel);panel.hidden=true; }
  hidePopover(element) { if(element.matches?.(':popover-open'))element.hidePopover(); }
  header(view, group, active, floating) {
    const visible=group.tabs.filter(id=>this.layout.visible(id)||id===this.solo);
    const signature=JSON.stringify([group.id,visible,active,floating,!!this.maximized]);
    if(view.signature===signature)return;view.signature=signature;view.tabs.replaceChildren();
    for(const id of visible){
      const button=Dom.button(this.title(id),()=>{if(!this.suppressClick)this.open(id);},{className:'dock-panel-tab',title:`${this.title(id)} · drag to dock, double-click to float`});
      button.dataset.panelTab=id;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(id===active));button.setAttribute('aria-controls',`${this.uid}-${id}-body`);button.tabIndex=id===active?0:-1;
      button.addEventListener('pointerdown',event=>this.beginDrag(event,{kind:'panel',id}));
      button.addEventListener('dblclick',()=>this.action(id,'float'));
      button.addEventListener('keydown',event=>{
        if((event.shiftKey&&event.key==='F10')||event.key==='ContextMenu'){event.preventDefault();event.stopPropagation();this.panelMenu(id,button);return;}
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();const index=visible.indexOf(id),target=visible[event.key==='Home'?0:event.key==='End'?visible.length-1:(index+(event.key==='ArrowLeft'?-1:1)+visible.length)%visible.length];
        if(event.ctrlKey||event.metaKey){
          const at=event.key==='Home'?0:event.key==='End'?visible.length-1:clamp(index+(event.key==='ArrowLeft'?-1:1),0,visible.length-1);
          this.layout.reorder(id,visible[at],event.key==='ArrowRight'||event.key==='End');this.changed();this.focusPanel(id);
        }else this.open(target);
      });view.tabs.append(button);
    }
  }
  placeSplitter(info) {
    const {node,rect}=info;let handle=this.splitters.get(node.id);
    if(!handle){
      handle=Dom.element('div','dock-splitter');handle.tabIndex=0;handle.setAttribute('role','separator');handle.dataset.split=node.id;this.root.append(handle);this.splitters.set(node.id,handle);
      handle.addEventListener('pointerdown',event=>this.beginDrag(event,{kind:'split',id:node.id,info:handle.info}));
      handle.addEventListener('pointermove',event=>this.dragMove(event));handle.addEventListener('pointerup',event=>this.finishDrag(false,event));handle.addEventListener('pointercancel',()=>this.finishDrag(true));handle.addEventListener('lostpointercapture',()=>{if(this.drag)this.finishDrag(true);});
      handle.addEventListener('dblclick',()=>{this.layout.setRatio(node.id,.5);this.changed();});
      handle.addEventListener('keydown',event=>{
        const axis=handle.info.node.axis,keys=axis==='x'?['ArrowLeft','ArrowRight']:['ArrowUp','ArrowDown'];
        if(![...keys,'Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();
        this.layout.setRatio(node.id,event.key==='Home'?.1:event.key==='End'?.9:handle.info.node.ratio+(event.key===keys[0]?-1:1)*(event.shiftKey?.1:.02));this.changed();
      });
    }
    handle.info=info;handle.dataset.axis=node.axis;handle.setAttribute('aria-orientation',node.axis==='x'?'vertical':'horizontal');handle.setAttribute('aria-label',`Resize ${this.title(this.firstVisible(node.first))} group`);
    handle.setAttribute('aria-controls',`${this.uid}-${this.firstVisible(node.first)}`);handle.setAttribute('aria-valuenow',String(Math.round(node.ratio*100)));handle.setAttribute('aria-valuemin','10');handle.setAttribute('aria-valuemax','90');this.position(handle,rect);
  }
  firstVisible(node) { return node.type==='group'?this.layout.active(node):this.firstVisible(node.first)??this.firstVisible(node.second); }
  showMenu(anchor,label,items) {
    this.closeMenu(false);this.menuAnchor=anchor;this.menu.replaceChildren(Dom.element('strong','dock-menu-title',label));this.menu.setAttribute('aria-label',label);
    for(const item of items){
      if(item.element){this.menu.append(item.element);continue;}
      const button=Dom.button(item.label,()=>{this.closeMenu(false);item.action();},{className:'dock-menu-item',icon:item.icon});button.disabled=!!item.disabled;this.menu.append(button);
    }
    this.menu.hidden=false;const rect=anchor.getBoundingClientRect();this.menu.style.left=`${clamp(rect.x,8,Math.max(8,innerWidth-292))}px`;this.menu.style.top=`${clamp(rect.bottom+4,8,Math.max(8,innerHeight-400))}px`;
    if(this.menu.showPopover)this.menu.showPopover();
    const bounds=this.menu.getBoundingClientRect();this.menu.style.left=`${clamp(rect.x,8,Math.max(8,innerWidth-bounds.width-8))}px`;this.menu.style.top=`${clamp(rect.bottom+4,8,Math.max(8,innerHeight-bounds.height-8))}px`;
    this.menu.querySelector('button,select,input')?.focus();
  }
  closeMenu(restoreFocus=true) { if(!this.menu)return;this.hidePopover(this.menu);this.menu.hidden=true;if(restoreFocus)this.menuAnchor?.focus({preventScroll:true}); }
  menuKey(event) {
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.closeMenu();}
    else if(['ArrowUp','ArrowDown'].includes(event.key)&&event.target.tagName!=='SELECT'){
      event.preventDefault();const items=[...this.menu.querySelectorAll('button:not(:disabled),select,input')],index=items.indexOf(document.activeElement);items[(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();
    }
  }
  panelMenu(id,anchor) {
    const title=this.title(id),target=Dom.element('select');target.setAttribute('aria-label',`Dock ${title} relative to`);
    for(const panel of this.definitions.keys())if(panel!==id){const option=Dom.element('option','',this.title(panel));option.value=panel;target.append(option);}target.value=id==='canvas'?'properties':'canvas';
    const direction=Dom.element('select');direction.setAttribute('aria-label',`Dock ${title} position`);
    for(const [value,label] of [['center','As a tab'],['left','Left'],['right','Right'],['top','Above'],['bottom','Below']]){const option=Dom.element('option','',label);option.value=value;direction.append(option);}
    const form=Dom.element('div','dock-menu-destination');form.append(Dom.element('label','','Relative to'),target,direction);
    this.showMenu(anchor,`${title} panel actions`,[
      {label:this.layout.floating(id)?`Dock ${title} back`:`Float ${title}`,icon:'split',action:()=>this.action(id,'float')},
      {label:this.maximized===id?'Restore panel size':`Maximize ${title}`,icon:'fit',action:()=>this.action(id,'maximize')},
      ...['left','right','top','bottom'].map(side=>({label:`Dock ${title} ${side}`,action:()=>this.action(id,side)})),
      {element:form},{label:'Apply docking',action:()=>{try{this.layout.dock(id,target.value,direction.value);this.maximized=null;this.compactPanel=id;this.changed();this.focusPanel(id);}catch(error){this.onError(error);}}},
      {label:`Hide ${title}`,icon:'close',action:()=>this.action(id,'close')}
    ]);
  }
  launcher(anchor,presets=[]) {
    this.showMenu(anchor,'Designer panels',[
      ...[...this.definitions.values()].map(({id,title})=>({label:`Show ${title}`,icon:this.layout.visible(id)?'check':'plus',action:()=>this.open(id)})),
      {label:'Show all panels',action:()=>{for(const id of this.definitions.keys())this.layout.open(id);this.maximized=null;this.changed();}},
      ...presets.map(({label,layout})=>({label,icon:'reset',action:()=>this.reset(layout)}))
    ]);
  }
  workspaceKey(event) {
    if(event.key!=='F6'||event.ctrlKey||event.metaKey||event.altKey||event.target.closest('.dock-menu'))return;
    event.preventDefault();event.stopPropagation();const ids=this.rectangles.map(item=>item.id),current=event.target.closest('[data-dock-panel]')?.dataset.dockPanel,index=ids.indexOf(current);this.focusPanel(ids[(index+(event.shiftKey?-1:1)+ids.length)%ids.length]);
  }
  beginDrag(event,operation) {
    if(event.button!==0||this.drag||this.solo||this.compact&&operation.kind==='panel')return;
    this.suppressClick=false;const capture=event.currentTarget;
    // Keep the pressed tab as the click target. Headers are retained for the whole
    // gesture; panel moves mutate the layout only after releasing capture.
    this.drag={...operation,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,capture,before:this.layout.snapshot(),active:false,box:operation.id&&this.layout.floating(operation.id)?{...this.layout.floating(operation.id)}:null};
    capture.setPointerCapture(event.pointerId);
    if(operation.kind!=='panel'){event.preventDefault();this.startShield();}
  }
  startShield() { if(!this.drag)return;this.drag.active=true;this.shield.hidden=false;if(this.shield.showPopover&&!this.shield.matches(':popover-open'))this.shield.showPopover();this.root.classList.add('dock-dragging'); }
  dragMove(event) {
    const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return;
    drag.x=event.clientX;drag.y=event.clientY;
    if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
    if(!drag.active)this.startShield();event.preventDefault();this.suppressClick=true;
    if(drag.kind==='split'){
      const horizontal=drag.info.node.axis==='x',extent=drag.info.bounds[horizontal?'width':'height']-5;
      this.layout.setRatio(drag.id,drag.info.node.ratio+(horizontal?drag.x-drag.startX:drag.y-drag.startY)/Math.max(1,extent));
      // Record the current pointer/ratio; subsequent events are incremental.
      drag.startX=drag.x;drag.startY=drag.y;this.render();this.guide.hidden=true;return;
    }
    if(drag.kind==='resize'){
      const rect=clampBox({...drag.box,width:drag.box.width+drag.x-drag.startX,height:drag.box.height+drag.y-drag.startY},innerWidth,innerHeight);
      this.layout.setBox(drag.id,rect);this.render();this.guide.hidden=true;return;
    }
    drag.target=this.hit(drag.id,drag.x,drag.y);this.guide.hidden=false;
    const rect=drag.target?.preview??clampBox({x:drag.x-30,y:drag.y-14,width:drag.box?.width??340,height:drag.box?.height??320},innerWidth,innerHeight);
    this.position(this.guide,rect);
    this.guide.textContent=drag.target?.label??`Float ${this.title(drag.id)} · Escape cancels`;
  }
  hit(id,x,y) {
    // Tabs reorder at the actual insertion position; dragging over content splits
    // at the nearest edge or groups in the center. Geometry ignores the shield.
    for(const entry of [...this.rectangles].reverse()) {
      if(!contains(entry.rect,x,y))continue;
      const view=this.panels.get(entry.id);
      for(const button of view.tabs.children){const rect=button.getBoundingClientRect();if(contains({x:rect.x,y:rect.y,width:rect.width,height:rect.height},x,y)&&button.dataset.panelTab!==id){const target=button.dataset.panelTab;return {target,zone:'center',index:entry.node.tabs.indexOf(target),preview:entry.rect,label:`Tab ${this.title(id)} before ${this.title(target)}`};}}
      const target=entry.node.tabs.find(tab=>tab!==id&&this.layout.visible(tab));if(!target)continue;
      const rx=(x-entry.rect.x)/entry.rect.width,ry=(y-entry.rect.y)/entry.rect.height;
      let zone=entry.floating?'center':rx<.22?'left':rx>.78?'right':ry<.25?'top':ry>.75?'bottom':'center';
      const preview={...entry.rect};if(['left','right'].includes(zone)){preview.width/=2;if(zone==='right')preview.x+=preview.width;}if(['top','bottom'].includes(zone)){preview.height/=2;if(zone==='bottom')preview.y+=preview.height;}
      return {target,zone,preview,label:zone==='center'?`Tab ${this.title(id)} with ${this.title(target)}`:`Dock ${this.title(id)} ${zone} of ${this.title(target)}`};
    }
    const rect=this.root.getBoundingClientRect(),box={x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    if(contains(box,x,y)){
      const distances=[['left',x-rect.x],['right',rect.right-x],['top',y-rect.y],['bottom',rect.bottom-y]].sort((a,b)=>a[1]-b[1]);
      if(distances[0][1]<24||!this.layout.value.root){const zone=distances[0][0],preview={...box};if(['left','right'].includes(zone)){preview.width*=.3;if(zone==='right')preview.x=rect.right-preview.width;}else{preview.height*=.3;if(zone==='bottom')preview.y=rect.bottom-preview.height;}return {target:null,zone,preview,label:`Dock ${this.title(id)} at workspace ${zone}`};}
    }
    return null;
  }
  finishDrag(cancel=false,event) {
    const drag=this.drag;if(!drag)return;this.drag=null;
    this.hidePopover(this.shield);this.shield.hidden=true;this.root.classList.remove('dock-dragging');
    if(drag.capture.hasPointerCapture?.(drag.pointerId))drag.capture.releasePointerCapture(drag.pointerId);
    try {
      if(cancel){this.layout.reset(drag.before);this.render();}
      else if(drag.active){
        if(drag.kind==='panel'){
          this.maximized=null;
          if(drag.target)this.layout.dock(drag.id,drag.target.target,drag.target.zone,drag.target.index??null);
          else this.layout.float(drag.id,clampBox({x:drag.x-30,y:drag.y-14,width:drag.box?.width??340,height:drag.box?.height??320},innerWidth,innerHeight));
          this.compactPanel=drag.id;
        }
        this.changed('Panel layout updated');this.focusPanel(drag.id);event?.preventDefault();
      }
    }catch(error){this.layout.reset(drag.before);this.render();this.onError(error);}
    if(drag.active){this.suppressClick=true;clearTimeout(this.clickTimer);this.clickTimer=setTimeout(()=>this.suppressClick=false,0);}
  }
  dispose() {
    if(this.disposed)return;this.finishDrag(true);this.closeMenu(false);this.disposed=true;this.abort.abort();this.observer.disconnect();cancelAnimationFrame(this.pending);clearTimeout(this.clickTimer);
    for(const {panel} of this.panels.values())this.conceal(panel);this.menu.remove();this.shield.remove();
  }
}
function contains(rect,x,y) { return x>=rect.x&&y>=rect.y&&x<=rect.x+rect.width&&y<=rect.y+rect.height; }
