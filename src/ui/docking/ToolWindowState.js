/**
 * Serializable tool-window ownership, independent of the DOM and viewport.
 * A sidebar position owns an ordered list of tools and at most one open docked
 * tool. Floating tools keep their sidebar home but do not occupy a dock slot.
 */
export const TOOL_SLOTS = Object.freeze(['left-top', 'left-bottom', 'right-top', 'right-bottom', 'bottom-left', 'bottom-right']);
export const TOOL_SIDES = Object.freeze(['left', 'right', 'bottom']);
export const TOOL_MODES = Object.freeze(['docked', 'unpinned', 'sliding', 'floating']);
export const SLOT_LABELS = Object.freeze({
  'left-top': 'Left Top', 'left-bottom': 'Left Bottom',
  'right-top': 'Right Top', 'right-bottom': 'Right Bottom',
  'bottom-left': 'Bottom Left', 'bottom-right': 'Bottom Right'
});
export const DEFAULT_SIZES = Object.freeze({left: 256, right: 304, bottom: 250});
export const TOOL_SHORTCUTS = Object.freeze({project: 'Alt+1', run: 'Alt+4', debugger: 'Alt+5', problems: 'Alt+6', structure: 'Alt+7', repositories: 'Alt+9', terminal: 'Alt+F12'});
const HOMES = {
  'left-top': ['project', 'repositories'], 'left-bottom': ['structure'],
  'right-top': ['cargo', 'crates', 'compiler', 'ui-studio'], 'right-bottom': ['agent', 'profile', 'language'],
  'bottom-left': ['run', 'debugger', 'terminal', 'problems', 'tests'], 'bottom-right': ['search', 'native-artifacts']
};
const OLD_LAYOUT = {left: ['project', 'structure', 'repositories', 'crates', 'cargo'], right: ['compiler', 'profile', 'native-artifacts', 'language', 'agent', 'ui-studio'], bottom: ['run', 'terminal', 'search', 'problems', 'debugger', 'tests']};
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const slotSide = slot => slot.split('-')[0];
export const primarySlot = side => side === 'bottom' ? 'bottom-left' : `${side}-top`;
const home = id => TOOL_SLOTS.find(slot => HOMES[slot].includes(id)) ?? 'right-top';
const number = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback;
const rectangle = value => ({x: number(value?.x, 80, -10000, 10000), y: number(value?.y, 80, -10000, 10000), width: number(value?.width, 520, 240, 4000), height: number(value?.height, 440, 160, 4000)});

export class ToolWindowState {
  constructor(ids, saved = null, legacy = null) {
    this.ids = new Set(ids);
    if (!this.ids.size || this.ids.size > 256 || [...this.ids].some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))) throw Error('Invalid tool-window registration');
    this.value = this.defaults();
    this.restoreVisibility = null;
    try {
      if (saved) this.value = this.validate(saved);
      else if (legacy) this.value = this.migrate(legacy);
    } catch { /* Restore atomically: corrupt storage cannot strand a registered tool. */ }
  }
  defaults() {
    const slots = Object.fromEntries(TOOL_SLOTS.map(slot => [slot, {order: [], active: null}]));
    const windows = {};
    for (const slot of TOOL_SLOTS) for (const id of HOMES[slot]) if (this.ids.has(id)) slots[slot].order.push(id);
    for (const id of this.ids) {
      const anchor = home(id);
      if (!slots[anchor].order.includes(id)) slots[anchor].order.push(id);
      windows[id] = {anchor, mode: 'docked', sidebar: true, open: false, box: rectangle()};
    }
    if (this.ids.has('project')) slots['left-top'].active = 'project';
    if (this.ids.has('cargo')) slots['right-top'].active = 'cargo';
    return {version: 4, slots, windows, sizes: {...DEFAULT_SIZES}, splits: {left: .5, right: .5, bottom: .5}, wide: false, lastTool: this.ids.has('project') ? 'project' : [...this.ids][0]};
  }
  validate(input) {
    if (input?.version !== 4 || !input.slots || !input.windows) throw Error('Unknown tool-window layout');
    const value = this.defaults(), seen = new Set();
    for (const slot of TOOL_SLOTS) {
      const source = input.slots[slot];
      if (!Array.isArray(source?.order) || source.order.length > 256) throw Error('Invalid sidebar order');
      value.slots[slot] = {order: [], active: null};
      for (const id of source.order) {
        if (typeof id !== 'string' || seen.has(id)) throw Error('Duplicate tool-window ownership');
        seen.add(id);
        if (!this.ids.has(id)) continue; // Removed plug-ins do not invalidate other placements.
        const entry = input.windows[id];
        if (!entry || entry.anchor !== slot || !TOOL_MODES.includes(entry.mode)) throw Error('Invalid tool-window state');
        value.slots[slot].order.push(id);
        value.windows[id] = {anchor: slot, mode: entry.mode, sidebar: entry.sidebar !== false, open: entry.mode === 'floating' && entry.open === true, box: rectangle(entry.box)};
      }
      const id = source.active;
      if (value.slots[slot].order.includes(id) && value.windows[id].mode !== 'floating') value.slots[slot].active = id;
    }
    for (const id of this.ids) if (!seen.has(id)) value.slots[home(id)].order.push(id);
    for (const side of TOOL_SIDES) {
      value.sizes[side] = number(input.sizes?.[side], DEFAULT_SIZES[side], side === 'bottom' ? 120 : 180, 1600);
      value.splits[side] = number(input.splits?.[side], .5, .15, .85);
    }
    value.wide = input.wide === true;
    if (this.ids.has(input.lastTool)) value.lastTool = input.lastTool;
    return value;
  }
  migrate(input) {
    if (!input.layout || TOOL_SIDES.some(side => !Array.isArray(input.layout[side]) || input.layout[side].length > 256)) throw Error('Invalid v3 layout');
    const all = TOOL_SIDES.flatMap(side => input.layout[side]);
    if (new Set(all).size !== all.length || all.some(id => typeof id !== 'string')) throw Error('Duplicate v3 tool');
    // Replace the untouched laboratory default, not a user's customized layout.
    const untouched = TOOL_SIDES.every(side => JSON.stringify(input.layout[side]) === JSON.stringify(OLD_LAYOUT[side].filter(id => all.includes(id)))) &&
      input.active?.left === 'project' && input.active?.right === 'compiler' && input.active?.bottom === 'run' &&
      (input.sizes?.left ?? 245) === 245 && (input.sizes?.right ?? 560) === 560 && (input.sizes?.bottom ?? 235) === 235 &&
      !input.hidden?.length && !input.collapsedRegions?.length;
    if (untouched) return this.defaults();
    const value = this.defaults(), seen = new Set();
    for (const slot of TOOL_SLOTS) value.slots[slot] = {order: [], active: null};
    for (const side of TOOL_SIDES) {
      const slot = primarySlot(side), order = input.layout[side].filter(id => this.ids.has(id));
      value.slots[slot].order = order;
      for (const id of order) { seen.add(id); value.windows[id].anchor = slot; }
      const visible = order.filter(id => !Array.isArray(input.hidden) || !input.hidden.includes(id));
      if (!input.collapsedRegions?.includes(side)) value.slots[slot].active = visible.includes(input.active?.[side]) ? input.active[side] : visible[0] ?? null;
      value.sizes[side] = number(input.sizes?.[side], DEFAULT_SIZES[side], side === 'bottom' ? 120 : 180, 1600);
    }
    for (const id of this.ids) if (!seen.has(id)) value.slots[home(id)].order.push(id);
    return value;
  }
  require(id) { if (!this.ids.has(id)) throw Error(`Unknown tool window: ${id}`); return this.value.windows[id]; }
  snapshot() { return structuredClone(this.value); }
  restore(value) { this.value = this.validate(value); }
  reset() { this.value = this.defaults(); this.restoreVisibility = null; }
  visible(id) { const tool = this.require(id); return tool.mode === 'floating' ? tool.open : this.value.slots[tool.anchor].active === id; }
  open(id) {
    const tool = this.require(id);
    tool.sidebar = true;
    if (tool.mode === 'floating') tool.open = true;
    else this.value.slots[tool.anchor].active = id;
    this.value.lastTool = id;
  }
  hide(id) {
    const tool = this.require(id);
    tool.open = false;
    if (this.value.slots[tool.anchor].active === id) this.value.slots[tool.anchor].active = null;
  }
  collapse(side) {
    if (!TOOL_SIDES.includes(side)) throw Error('Invalid tool-window side');
    for (const slot of TOOL_SLOTS.filter(slot => slotSide(slot) === side)) this.value.slots[slot].active = null;
  }
  move(id, anchor, before = null) {
    const tool = this.require(id);
    if (!TOOL_SLOTS.includes(anchor)) throw Error('Invalid tool-window position');
    if (before !== null && !this.value.slots[anchor].order.includes(before)) throw Error('Invalid sidebar insertion target');
    if (before === id && tool.anchor === anchor) return;
    const old = this.value.slots[tool.anchor];
    old.order = old.order.filter(item => item !== id);
    if (old.active === id) old.active = null;
    const next = this.value.slots[anchor];
    next.order.splice(before === null ? next.order.length : next.order.indexOf(before), 0, id);
    tool.anchor = anchor; tool.mode = 'docked'; tool.open = false;
    this.open(id);
  }
  setMode(id, mode) {
    const tool = this.require(id);
    if (!TOOL_MODES.includes(mode)) throw Error('Invalid tool-window view mode');
    this.hide(id); tool.mode = mode; this.open(id);
  }
  setSidebar(id, visible) { const tool = this.require(id); tool.sidebar = !!visible; if (!visible) this.hide(id); }
  setSize(side, value) {
    if (!TOOL_SIDES.includes(side) || !Number.isFinite(value)) throw Error('Invalid tool-window size');
    this.value.sizes[side] = clamp(value, side === 'bottom' ? 120 : 180, 1600);
  }
  setSplit(side, ratio) {
    if (!TOOL_SIDES.includes(side) || !Number.isFinite(ratio)) throw Error('Invalid tool-window split');
    this.value.splits[side] = clamp(ratio, .15, .85);
  }
  setBox(id, box) { const tool = this.require(id); tool.box = rectangle({...tool.box, ...box}); }
  toggleAll() {
    const visible = [...this.ids].filter(id => this.visible(id));
    if (visible.length) {
      this.restoreVisibility = {ids: visible, lastTool: this.value.lastTool};
      for (const id of visible) this.hide(id);
    } else if (this.restoreVisibility) {
      for (const id of this.restoreVisibility.ids) if (this.ids.has(id)) this.open(id);
      this.value.lastTool = this.restoreVisibility.lastTool;
      this.restoreVisibility = null;
    }
  }
}

/** Clamping is presentation-only: smaller screens never overwrite a saved box. */
export function clampToolBox(box, width, height) {
  const inset = Math.min(8, width / 8, height / 8), w = Math.min(Math.max(240, box.width), Math.max(0, width - 2 * inset)), h = Math.min(Math.max(160, box.height), Math.max(0, height - 2 * inset));
  return {x: clamp(box.x, inset, Math.max(inset, width - w - inset)), y: clamp(box.y, inset, Math.max(inset, height - h - inset)), width: w, height: h};
}
