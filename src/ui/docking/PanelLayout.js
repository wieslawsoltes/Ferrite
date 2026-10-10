/** Serializable, DOM-independent split/tab/floating layout. Every panel occurs once. */
export class PanelLayout {
  constructor(ids, initial, saved = null) {
    this.ids = new Set(ids);
    if (!this.ids.size || this.ids.size > 64) throw Error('A dock workspace needs 1–64 unique panel IDs');
    this.initial = this.validate(initial);
    try { this.value = saved ? this.validate(saved) : structuredClone(this.initial); }
    catch { this.value = structuredClone(this.initial); }
    this.serial = 0;
  }
  validate(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.floating) || value.floating.length > 64 || !Array.isArray(value.hidden)) throw Error('Invalid panel layout');
    const panels = new Set(), nodes = new Set();
    const read = (node, depth = 0) => {
      if (!node) return null;
      if (depth > 20 || typeof node.id !== 'string' || node.id.length > 100 || nodes.has(node.id)) throw Error('Invalid dock tree');
      nodes.add(node.id);
      if (node.type === 'group') {
        if (!Array.isArray(node.tabs) || !node.tabs.length || node.tabs.length > 64) throw Error('Invalid panel group');
        for (const id of node.tabs) {
          if (!this.ids.has(id) || panels.has(id)) throw Error('Unknown or duplicate panel');
          panels.add(id);
        }
        return {type: 'group', id: node.id, tabs: [...node.tabs], active: node.tabs.includes(node.active) ? node.active : node.tabs[0]};
      }
      if (node.type !== 'split' || !['x', 'y'].includes(node.axis) || !Number.isFinite(node.ratio) || !node.first || !node.second) throw Error('Invalid split');
      return {type: 'split', id: node.id, axis: node.axis, ratio: clamp(node.ratio, .1, .9), first: read(node.first, depth + 1), second: read(node.second, depth + 1)};
    };
    const root = read(value.root);
    const floating = value.floating.map(box => {
      if (box?.node?.type !== 'group' || !['x','y','width','height'].every(key => Number.isFinite(box[key]) && Math.abs(box[key]) < 100000)) throw Error('Invalid floating window');
      return {node: read(box.node), x: box.x, y: box.y, width: clamp(box.width, 200, 4000), height: clamp(box.height, 140, 4000)};
    });
    if (panels.size !== this.ids.size) throw Error('Missing panel');
    const homes = {};
    for (const id of this.ids) {
      const home = value.homes?.[id];
      if (home && this.ids.has(home.target) && home.target !== id && ZONES.includes(home.zone)) homes[id] = {target: home.target, zone: home.zone, ...(Number.isInteger(home.index) ? {index:clamp(home.index,0,64)} : {})};
    }
    return {version: 1, root, floating, hidden: [...new Set(value.hidden.filter(id => this.ids.has(id)))], homes};
  }
  snapshot() { return structuredClone(this.value); }
  reset(layout = this.initial) { this.value = this.validate(layout); }
  nodes() {
    const result = [];
    const visit = node => { if (!node) return; result.push(node); if (node.type === 'split') { visit(node.first); visit(node.second); } };
    visit(this.value.root); for (const box of this.value.floating) visit(box.node); return result;
  }
  group(id) { return this.nodes().find(node => node.type === 'group' && node.tabs.includes(id)); }
  floating(id) { return this.value.floating.find(box => box.node.tabs.includes(id)); }
  visible(id) { return this.ids.has(id) && !this.value.hidden.includes(id); }
  active(group) { return group.tabs.find(id => id === group.active && this.visible(id)) ?? group.tabs.find(id => this.visible(id)); }
  require(id) { if (!this.ids.has(id)) throw Error(`Unknown panel: ${id}`); }
  open(id) { this.require(id); this.value.hidden = this.value.hidden.filter(item => item !== id); this.group(id).active = id; }
  close(id) { this.require(id); if (this.visible(id)) this.value.hidden.push(id); }
  uid(prefix) { const ids = new Set(this.nodes().map(node => node.id)); let id; do { id = `${prefix}-${++this.serial}`; } while (ids.has(id)); return id; }
  remove(id) {
    const prune = node => {
      if (!node) return null;
      if (node.type === 'group') {
        node.tabs = node.tabs.filter(item => item !== id);
        if (!node.tabs.length) return null;
        if (node.active === id) node.active = node.tabs[0];
      } else { node.first = prune(node.first); node.second = prune(node.second); if (!node.first || !node.second) return node.first ?? node.second; }
      return node;
    };
    this.value.root = prune(this.value.root);
    this.value.floating = this.value.floating.filter(box => (box.node = prune(box.node)) !== null);
  }
  rememberHome(id) {
    if (this.floating(id)) return;
    const group = this.group(id), sibling = group.tabs.find(tab => tab !== id);
    if (sibling) { this.value.homes[id] = {target: sibling, zone: 'center', index: group.tabs.indexOf(id)}; return; }
    const visit = node => {
      if (!node || node.type !== 'split') return false;
      if (node.first === group || node.second === group) {
        const before = node.first === group, other = before ? node.second : node.first;
        this.value.homes[id] = {target: firstPanel(other), zone: node.axis === 'x' ? (before ? 'left' : 'right') : (before ? 'top' : 'bottom')}; return true;
      }
      return visit(node.first) || visit(node.second);
    };
    visit(this.value.root);
  }
  /** Drop relative to a panel, or target=null for the outer workspace edge. */
  dock(id, target = null, zone = 'center', index = null) {
    this.require(id); if (target !== null) this.require(target);
    if (!ZONES.includes(zone)) throw Error('Invalid docking direction');
    if (id === target) return false;
    let group = target === null ? null : this.group(target);
    if (zone !== 'center' && group && this.value.floating.some(box => box.node === group)) throw Error('Split a docked group, or tab into a floating window');
    this.remove(id);
    const fresh = {type: 'group', id: this.uid('group'), tabs: [id], active: id};
    group = target === null ? null : this.group(target);
    if (zone === 'center' && group) {
      group.tabs.splice(index === null ? group.tabs.length : clamp(index, 0, group.tabs.length), 0, id); group.active = id;
    } else if (!this.value.root && !group) this.value.root = fresh;
    else {
      const before = ['left','top'].includes(zone), old = group ?? this.value.root;
      const split = {type: 'split', id: this.uid('split'), axis: ['top','bottom'].includes(zone) ? 'y' : 'x', ratio: before ? .3 : .7, first: before ? fresh : old, second: before ? old : fresh};
      if (!group || this.value.root === group) this.value.root = split;
      else {
        const parent = this.nodes().find(node => node.type === 'split' && (node.first === group || node.second === group));
        if (parent) parent[parent.first === group ? 'first' : 'second'] = split;
      }
    }
    this.open(id); return true;
  }
  reorder(id, before) {
    this.require(id); this.require(before);
    const group = this.group(id);
    if (group !== this.group(before) || id === before) return false;
    group.tabs = group.tabs.filter(tab => tab !== id); group.tabs.splice(group.tabs.indexOf(before), 0, id); group.active = id; return true;
  }
  float(id, rectangle = {}) {
    this.require(id);
    if (this.floating(id)?.node.tabs.length === 1) { this.open(id); this.setBox(id, rectangle); return; }
    this.rememberHome(id); this.remove(id);
    const number = (key, fallback) => Number.isFinite(rectangle[key]) ? rectangle[key] : fallback;
    this.value.floating.push({node: {type:'group', id:this.uid('float'), tabs:[id], active:id}, x:number('x',80), y:number('y',80), width:clamp(number('width',420),200,4000), height:clamp(number('height',420),140,4000)});
    this.open(id);
  }
  redock(id) {
    this.require(id); const home = this.value.homes[id];
    if (home && this.group(home.target) && (!this.floating(home.target) || home.zone === 'center')) return this.dock(id, home.target, home.zone, home.index ?? null);
    const target = this.ids.has('canvas') && id !== 'canvas' && !this.floating('canvas') ? 'canvas' : firstPanel(this.value.root);
    return this.dock(id, target === id ? null : target, 'right');
  }
  setRatio(id, ratio) {
    if (!Number.isFinite(ratio)) throw Error('Invalid split ratio');
    const split = this.nodes().find(node => node.id === id && node.type === 'split');
    if (split) split.ratio = clamp(ratio, .1, .9);
  }
  setBox(id, rectangle) {
    const box = this.floating(id); if (!box) return;
    for (const key of ['x','y','width','height']) if (Number.isFinite(rectangle[key])) box[key] = key === 'width' ? clamp(rectangle[key],200,4000) : key === 'height' ? clamp(rectangle[key],140,4000) : clamp(rectangle[key],-9999,9999);
  }
  /** Hidden groups consume no space. Fractional geometry does not mutate saved ratios. */
  measure(width, height) {
    const groups = [], splits = [];
    const sizes = new Map(); for (const node of this.nodes().reverse()) {
      if (node.type === 'group') sizes.set(node.id, this.active(node)?{width:150,height:100}:{width:0,height:0});
      else { const a=sizes.get(node.first.id),b=sizes.get(node.second.id); sizes.set(node.id,!a.width?b:!b.width?a:node.axis==='x'?{width:a.width+b.width+5,height:Math.max(a.height,b.height)}:{width:Math.max(a.width,b.width),height:a.height+b.height+5}); }
    }
    const visit = (node, rect) => {
      if (!node || !sizes.get(node.id).width) return;
      if (node.type === 'group') { groups.push({node,...rect}); return; }
      const a=sizes.get(node.first.id),b=sizes.get(node.second.id);
      if (!a.width) {visit(node.second,rect);return;} if(!b.width){visit(node.first,rect);return;}
      const horizontal=node.axis==='x',dimension=horizontal?'width':'height',gap=Math.min(5,rect[dimension]),total=Math.max(0,rect[dimension]-gap);
      const minA=a[dimension],minB=b[dimension],space=total>=minA+minB?clamp(total*node.ratio,minA,total-minB):total*minA/(minA+minB);
      const first={...rect,[dimension]:space},second={...rect,[horizontal?'x':'y']:rect[horizontal?'x':'y']+space+gap,[dimension]:Math.max(0,total-space)};
      splits.push({node,rect:{x:horizontal?rect.x+space:rect.x,y:horizontal?rect.y:rect.y+space,width:horizontal?gap:rect.width,height:horizontal?rect.height:gap},bounds:rect});
      visit(node.first,first);visit(node.second,second);
    };
    visit(this.value.root,{x:0,y:0,width:Math.max(0,width),height:Math.max(0,height)});return {groups,splits};
  }
}
export const ZONES = ['left','right','top','bottom','center'];
export function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
export function firstPanel(node) { return !node ? null : node.type === 'group' ? node.tabs[0] : firstPanel(node.first); }
export function clampBox(box, width, height) {
  const w=Math.min(Math.max(200,box.width),Math.max(1,width-16)),h=Math.min(Math.max(140,box.height),Math.max(1,height-16));
  return {x:clamp(box.x,8,Math.max(8,width-w-8)),y:clamp(box.y,8,Math.max(8,height-h-8)),width:w,height:h};
}
