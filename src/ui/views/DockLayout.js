import {Dom} from './Dom.js';

/** Three tabbed docking regions plus resizable floating tool windows. */
export class DockLayout {
  constructor(root, definitions, {storage = null} = {}) {
    this.root = root; this.storage = storage; this.definitions = definitions; this.panels = new Map(definitions.map(p => [p.id, p]));
    this.initial = {left: ['project','structure','cargo'], right: ['compiler','profile','native-artifacts'], bottom: ['run','problems','debugger','tests']};
    this.layout = structuredClone(this.initial); this.active = {left:'project',right:'compiler',bottom:'run'};
    this.sizes = {left:245,right:560,bottom:235}; this.hidden = new Set(); this.floating = new Set(); this.homes = new Map(); this.floatBoxes = new Map();
    this.restore(); this.regions = new Map();
    for (const side of ['left','right','bottom']) {
      const host = root.querySelector(`[data-dock="${side}"]`), tabs = Dom.element('div','tool-tabs'), body = Dom.element('div','tool-body');
      tabs.setAttribute('role','tablist'); host.append(tabs,body); this.regions.set(side,{host,tabs,body});
      tabs.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-ferrite-tool')){e.preventDefault();host.classList.add('dock-target');}});
      tabs.addEventListener('dragleave',()=>host.classList.remove('dock-target'));
      tabs.addEventListener('drop',e=>{e.preventDefault();host.classList.remove('dock-target');const id=e.dataTransfer.getData('application/x-ferrite-tool');if(this.panels.has(id))this.move(id,side);});
      this.resize(side);
    }
    this.render();
  }
  restore() {
    try {
      const value=JSON.parse(this.storage?.getItem('ferrite.layout.v3')??'null');if(!value)return;
      const seen=new Set();for(const side of ['left','right','bottom']){
        if(!Array.isArray(value.layout?.[side]))return;
        for(const id of value.layout[side]){if(!this.panels.has(id)||seen.has(id))return;seen.add(id);}
      }
      if(seen.size!==this.panels.size)return;
      this.layout=value.layout;
      for(const side of ['left','right','bottom']){if(this.layout[side].includes(value.active?.[side]))this.active[side]=value.active[side];const n=value.sizes?.[side];if(Number.isFinite(n))this.sizes[side]=Math.max(side==='bottom'?130:180,Math.min(side==='bottom'?600:850,n));}
      this.hidden=new Set((value.hidden??[]).filter(id=>this.panels.has(id)));
    } catch { /* Invalid saved layouts cannot prevent startup. */ }
  }
  save(){try{this.storage?.setItem('ferrite.layout.v3',JSON.stringify({layout:this.layout,active:this.active,sizes:this.sizes,hidden:[...this.hidden]}));}catch{}}
  side(id){return Object.keys(this.layout).find(side=>this.layout[side].includes(id))??'right';}
  open(id){if(!this.panels.has(id))return;this.hidden.delete(id);if(!this.floating.has(id)&&((window.innerWidth<620&&this.side(id)!=='bottom')||(window.innerWidth<900&&this.side(id)==='left'))){this.float(id);return;}if(this.floating.has(id)){this.floatBoxes.get(id)?.focus();return;}this.active[this.side(id)]=id;this.render();}
  toggle(id){
    if(!this.panels.has(id))return;
    // An active tab can still be invisible because the responsive layout
    // collapses its entire region. In that case the rail must reveal it.
    const host=this.regions.get(this.side(id))?.host;
    const collapsed=host&&!host.getClientRects().length;
    if(this.floating.has(id)){this.floatBoxes.get(id)?.focus();return;}
    if(collapsed||this.hidden.has(id)||this.active[this.side(id)]!==id)this.open(id);
    else{this.hidden.add(id);this.render();}
  }
  move(id,side){if(!this.regions.has(side))return;this.floating.delete(id);this.floatBoxes.get(id)?.remove();this.floatBoxes.delete(id);for(const key of Object.keys(this.layout))this.layout[key]=this.layout[key].filter(p=>p!==id);this.layout[side].push(id);this.hidden.delete(id);this.active[side]=id;this.render();}
  float(id){
    if(this.floating.has(id))return;this.floating.add(id);const panel=this.panels.get(id),box=Dom.element('section','floating-tool'),header=Dom.element('div','floating-title');
    box.tabIndex=-1;box.style.left=Math.max(8,Math.min(window.innerWidth*.35,window.innerWidth-620))+'px';box.style.top=Math.min(140,window.innerHeight*.15)+'px';
    header.append(Dom.icon(panel.icon),Dom.element('strong','',panel.title),Dom.button('Dock',()=>this.move(id,this.side(id)),{icon:'split',className:'float-dock'}));
    const body=Dom.element('div','floating-body');body.append(panel.element);box.append(header,body);document.body.append(box);this.floatBoxes.set(id,box);
    let start=null;
    header.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;start={x:e.clientX,y:e.clientY,left:box.offsetLeft,top:box.offsetTop};header.setPointerCapture(e.pointerId);});
    header.addEventListener('pointermove',e=>{if(!start)return;box.style.left=Math.max(0,Math.min(window.innerWidth-100,start.left+e.clientX-start.x))+'px';box.style.top=Math.max(0,Math.min(window.innerHeight-50,start.top+e.clientY-start.y))+'px';});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(name,()=>{start=null;});this.render();
  }
  render(){
    for(const [side,{host,tabs,body}] of this.regions){
      const ids=this.layout[side].filter(id=>!this.hidden.has(id)&&!this.floating.has(id));
      if(!ids.includes(this.active[side]))this.active[side]=ids[0]??null;
      host.hidden=ids.length===0;rootStyle(this.root,side,ids.length?this.sizes[side]:0);this.root.querySelector(`[data-resize="${side}"]`).hidden=ids.length===0;
      tabs.replaceChildren();body.replaceChildren();
      for(const id of ids){const panel=this.panels.get(id),button=Dom.button(panel.title,()=>this.open(id),{icon:panel.icon,className:'tool-tab'});button.dataset.panel=id;button.draggable=true;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(this.active[side]===id));button.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-ferrite-tool',id);e.dataTransfer.effectAllowed='move';});button.addEventListener('dblclick',()=>this.float(id));button.classList.toggle('active',this.active[side]===id);tabs.append(button);}
      const id=this.active[side];if(id){const controls=Dom.element('div','tool-controls');controls.append(Dom.button('',()=>this.float(id),{icon:'split',className:'icon-button',title:'Float tool window (or double-click its tab)'}),Dom.button('',()=>{this.hidden.add(id);this.render();},{icon:'minus',className:'icon-button',title:'Hide tool window'}));tabs.append(controls);body.append(this.panels.get(id).element);}
    }
    this.save();this.root.dispatchEvent(new CustomEvent('dock-layout'));
  }
  resize(side){const handle=this.root.querySelector(`[data-resize="${side}"]`);handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-label',`Resize ${side} tool windows`);handle.setAttribute('aria-orientation',side==='bottom'?'horizontal':'vertical');let start=null;
    const change=value=>{this.sizes[side]=Math.max(side==='bottom'?130:180,Math.min(side==='bottom'?window.innerHeight*.7:window.innerWidth*.6,value));rootStyle(this.root,side,this.sizes[side]);handle.setAttribute('aria-valuenow',String(Math.round(this.sizes[side])));};
    handle.addEventListener('pointerdown',e=>{e.preventDefault();start={x:e.clientX,y:e.clientY,size:this.sizes[side]};handle.setPointerCapture(e.pointerId);document.body.classList.add('resizing');});
    handle.addEventListener('pointermove',e=>{if(start)change(start.size+(side==='bottom'?start.y-e.clientY:side==='right'?start.x-e.clientX:e.clientX-start.x));});
    const end=()=>{start=null;document.body.classList.remove('resizing');this.save();};for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(name,end);
    handle.addEventListener('keydown',e=>{const increase=side==='left'?'ArrowRight':side==='bottom'?'ArrowUp':'ArrowLeft';const decrease=side==='left'?'ArrowLeft':side==='bottom'?'ArrowDown':'ArrowRight';if([increase,decrease].includes(e.key)){e.preventDefault();change(this.sizes[side]+(e.key===increase?20:-20));this.save();}});
  }
  reset(){for(const box of this.floatBoxes.values())box.remove();this.floatBoxes.clear();this.floating.clear();this.hidden.clear();this.layout=structuredClone(this.initial);this.active={left:'project',right:'compiler',bottom:'run'};this.sizes={left:245,right:560,bottom:235};this.render();}
}
function rootStyle(root,side,size){root.style.setProperty(`--${side}-size`,`${size}px`);}
