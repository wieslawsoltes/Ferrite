import {Dom} from './Dom.js';
import {ContextMenu} from './ContextMenu.js';
import {ToolWindowState, TOOL_SLOTS, TOOL_SIDES, SLOT_LABELS, primarySlot, slotSide, clampToolBox} from '../docking/ToolWindowState.js';
import {measureToolWindows} from '../docking/ToolWindowGeometry.js';
import {ToolWindowSidebar} from '../docking/ToolWindowSidebar.js';
import {ToolWindowInput} from '../docking/ToolWindowInput.js';

const STORAGE_KEY = 'ferrite.layout.v4';
const read = (storage, key) => { try { const text = storage?.getItem(key); return text && text.length < 262144 ? JSON.parse(text) : null; } catch { return null; } };

/**
 * RustRover-style tool windows around a permanent editor surface.
 * Every tool body is mounted once. Dock, hide, resize and float only change
 * geometry/visibility; iframe, terminal and designer sessions are never reparented.
 */
export class DockLayout {
  constructor(root, definitions, {storage = null} = {}) {
    this.root = root; this.storage = storage; this.definitions = definitions;
    this.panels = new Map(definitions.map(panel => [panel.id, panel]));
    if (this.panels.size !== definitions.length) throw Error('Duplicate tool-window registration');
    this.state = new ToolWindowState(this.panels.keys(), read(storage, STORAGE_KEY), read(storage, 'ferrite.layout.v3'));
    this.views = new Map(); this.regions = new Map(); this.dividers = new Map(); this.abort = new AbortController();
    this.maximized = null; this.overlay = null; this.shown = new Set(); this.pending = 0;
    root.classList.add('rustrover-dock'); this.editor = root.querySelector('.editor-region');
    this.input = new ToolWindowInput(this);
    for (const definition of definitions) this.mount(definition);
    for (const side of TOOL_SIDES) {
      const host = root.querySelector(`[data-dock="${side}"]`); this.regions.set(side, {host});
      host.setAttribute('aria-hidden', 'true');
      this.acceptDrop(host, () => ({slot: primarySlot(side)}));
      for (const kind of ['size', 'split']) {
        const handle = kind === 'size' ? root.querySelector(`[data-resize="${side}"]`) : Dom.element('div');
        handle.classList.add('tool-window-divider'); handle.dataset.divider = `${kind}-${side}`;
        if (kind === 'split') { handle.dataset.toolSplit = side; root.append(handle); }
        const horizontal = kind === 'size' ? side === 'bottom' : side !== 'bottom';
        handle.dataset.axis = horizontal ? 'y' : 'x'; handle.tabIndex = 0;
        handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', `${kind === 'size' ? 'Resize' : 'Split'} ${side} tool windows`);
        handle.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical');
        handle.setAttribute('aria-valuemin', kind === 'split' ? '15' : side === 'bottom' ? '120' : '180');
        handle.setAttribute('aria-valuemax', kind === 'split' ? '85' : '1600');
        this.input.splitter(handle, kind, side); this.dividers.set(`${kind}-${side}`, handle);
      }
    }
    this.announcement = Dom.element('div', 'tool-window-announcement'); this.announcement.setAttribute('role', 'status'); root.append(this.announcement);
    this.observer = new ResizeObserver(() => this.schedule()); this.observer.observe(root);
    window.addEventListener('resize', () => this.schedule(), {signal: this.abort.signal});
    document.addEventListener('pointerdown', event => this.dismissOutside(event), {signal: this.abort.signal});
    document.addEventListener('focusin', event => {
      if (event.target.closest?.('.editor-region')) this.editorFocus = event.target;
      this.dismissOutside(event);
    }, {signal: this.abort.signal});
    this.render(); this.save();
  }
  mount({id, title, element}) {
    const card = Dom.element('section', 'tool-window'), header = Dom.element('div', 'tool-window-header'), actions = Dom.element('div', 'tool-window-actions');
    card.id = `tool-window-${id}`; card.dataset.toolWindow = id; card.setAttribute('aria-label', `${title} tool window`); card.tabIndex = -1;
    const titleButton = Dom.button(title, () => this.focus(id), {className: 'tool-window-title tool-tab', title: `${title} · drag to move, double-click to maximize`});
    titleButton.dataset.panel = id;
    const selector = this.iconButton(`Select tool window beside ${title}`, 'down', () => this.selectMenu(id, selector));
    selector.classList.add('tool-window-selector'); selector.setAttribute('aria-haspopup', 'menu');
    const dock = Dom.button('Dock', () => this.setMode(id, 'docked'), {icon: 'split', className: 'tool-redock', title: `Dock ${title}`});
    const maximize = this.iconButton(`Maximize ${title} tool window`, 'fit', () => this.maximize(id));
    const more = this.iconButton(`${title} tool window options`, 'menu', () => this.panelMenu(id, more)); more.setAttribute('aria-haspopup', 'menu');
    const hide = this.iconButton(`Hide ${title} tool window`, 'minus', () => this.hide(id));
    actions.append(dock, maximize, more, hide); header.append(titleButton, selector, actions);
    const body = Dom.element('div', 'tool-window-body tool-body'); body.append(element);
    const resize = this.iconButton(`Resize floating ${title}`, 'grip', null); resize.classList.add('tool-window-float-resize');
    card.append(header, body, resize); this.root.append(card);
    this.views.set(id, {card, header, body, title: titleButton, dock, maximize, more, resize});
    this.dragHandle(header, id); this.input.floatResize(resize, id);
    header.addEventListener('dblclick', event => { if (!event.target.closest('.tool-window-actions,.tool-window-selector')) { ContextMenu.current?.(false); this.maximize(id); } }, {signal: this.abort.signal});
    header.addEventListener('contextmenu', event => { event.preventDefault(); this.panelMenu(id, more); }, {signal: this.abort.signal});
    this.acceptDrop(header, () => ({slot: this.state.require(id).anchor}));
    card.addEventListener('pointerdown', () => this.raise(id), {signal: this.abort.signal});
    card.addEventListener('focusin', () => { this.state.value.lastTool = id; this.raise(id); }, {signal: this.abort.signal});
  }
  iconButton(title, icon, action) {
    const button = Dom.button('', action, {icon, className: 'icon-button', title}); button.setAttribute('aria-label', title); return button;
  }
  attachSidebars(options) { this.sidebar = new ToolWindowSidebar(this, options); this.render(); }
  dragHandle(element, id) { this.input.handle(element, id); }
  acceptDrop(element, destination) { this.input.acceptDrop(element, destination); }
  get layout() { return Object.fromEntries(TOOL_SIDES.map(side => [side, TOOL_SLOTS.filter(slot => slotSide(slot) === side).flatMap(slot => this.state.value.slots[slot].order)])); }
  get active() { return Object.fromEntries(TOOL_SIDES.map(side => [side, TOOL_SLOTS.filter(slot => slotSide(slot) === side).map(slot => this.state.value.slots[slot].active).find(Boolean) ?? null])); }
  get sizes() { return this.state.value.sizes; }
  get floating() { return new Set([...this.panels.keys()].filter(id => this.state.require(id).mode === 'floating')); }
  get floatBoxes() { return new Map([...this.floating].map(id => [id, this.views.get(id).card])); }
  side(id) { return slotSide(this.state.require(id).anchor); }
  snapshot() { return {...this.state.snapshot(), presentation: {shown: [...this.shown], maximized: this.maximized, overlay: this.overlay}}; }
  save() { try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state.snapshot())); } catch { /* Private/quota-limited storage is optional. */ } }
  changed(message = '') { this.render(); this.save(); if (message) this.announcement.textContent = message; }
  schedule() { if (this.disposed || this.pending) return; this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); }); }
  open(id, {focus = true} = {}) {
    this.dismissTransient(id); this.state.open(id); this.overlay = id;
    if (this.maximized && this.maximized !== id) this.maximized = null;
    this.changed(`${this.panels.get(id).title} opened`); if (focus) this.focus(id);
  }
  toggle(id) { if (this.shown.has(id)) this.hide(id); else this.open(id); }
  hide(id, {focus = true} = {}) {
    this.state.hide(id); if (this.overlay === id) this.overlay = null; if (this.maximized === id) this.maximized = null;
    this.changed(`${this.panels.get(id).title} hidden`); if (focus) this.focusEditor();
  }
  collapse(side) { this.state.collapse(side); if (this.overlay && this.side(this.overlay) === side) this.overlay = null; this.maximized = null; this.changed(); }
  move(id, position, before = null) {
    const slot = TOOL_SIDES.includes(position) ? primarySlot(position) : position;
    this.state.move(id, slot, before); this.maximized = null; this.overlay = id;
    this.changed(`${this.panels.get(id).title} moved to ${SLOT_LABELS[slot]}`); this.focus(id);
  }
  float(id, box = null) {
    const tool = this.state.require(id);
    if (tool.mode !== 'floating') {
      const current = this.views.get(id).card.getBoundingClientRect();
      this.state.setBox(id, box ?? {x: current.width ? current.x + 24 : 80, y: current.height ? current.y + 24 : 80, width: Math.max(360, current.width), height: Math.max(280, current.height)});
      this.state.setMode(id, 'floating');
    } else { if (box) this.state.setBox(id, box); this.state.open(id); }
    this.maximized = null; this.changed(`${this.panels.get(id).title} floating`); this.focus(id);
  }
  setMode(id, mode) {
    if (mode === 'floating') return this.float(id);
    this.state.setMode(id, mode); this.overlay = id; this.maximized = null; this.changed(); this.focus(id);
  }
  maximize(id) { this.state.open(id); this.maximized = this.maximized === id ? null : id; this.overlay = id; this.changed(); this.focus(id); }
  hideAll() { this.state.toggleAll(); this.overlay = null; this.maximized = null; this.changed(); this.focusEditor(); }
  reset() { this.input.finish(true); ContextMenu.current?.(false); this.state.reset(); this.maximized = null; this.overlay = null; this.changed('Default IDE layout restored'); }
  restore(snapshot) { this.input.finish(true); this.state.restore(snapshot); this.maximized = null; this.overlay = null; this.changed('IDE layout restored'); }
  raise(id) {
    const card = this.views.get(id)?.card;
    if (this.input.drag || this.frontFloating === id || !card?.matches(':popover-open')) return;
    this.hidePopover(card); this.frontFloating = id; card.showPopover();
  }
  focus(id) {
    const card = this.views.get(id)?.card; if (!card || card.hidden) return;
    const input = [...card.querySelectorAll('textarea,input:not([type=checkbox]),[contenteditable=true]')].find(node => node.getClientRects().length && !node.disabled);
    this.raise(id); (input ?? card).focus({preventScroll: true});
  }
  focusEditor() {
    const input = this.editorFocus?.isConnected && this.editorFocus.getClientRects().length ? this.editorFocus : [...this.editor.querySelectorAll('textarea')].find(node => node.getClientRects().length);
    input?.focus({preventScroll: true});
  }
  dismissTransient(except = null) {
    let changed = false;
    for (const id of this.shown) if (id !== except && ['unpinned', 'sliding'].includes(this.state.require(id).mode)) { this.state.hide(id); changed = true; }
    if (this.overlay && this.overlay !== except && this.views.get(this.overlay)?.card.dataset.overlay === 'true') { this.overlay = null; changed = true; }
    return changed;
  }
  dismissOutside(event) {
    if (this.input.drag || event.target.closest?.('.context-menu,dialog,.tool-rail,.tool-window-header,[role=separator],.tool-window-float-resize')) return;
    const id = event.target.closest?.('[data-tool-window]')?.dataset.toolWindow ?? null;
    if (this.dismissTransient(id)) this.changed();
  }
  selectMenu(id, anchor) {
    const tool = this.state.require(id), rect = anchor.getBoundingClientRect();
    const items = this.state.value.slots[tool.anchor].order.map(key => ({label: this.panels.get(key).title, icon: this.panels.get(key).icon, execute: () => this.open(key)}));
    ContextMenu.open(items, {x: rect.x, y: rect.bottom, anchor});
  }
  panelMenu(id, anchor) {
    const tool = this.state.require(id), rect = anchor.getBoundingClientRect();
    const submenu = items => ContextMenu.open(items, {x: rect.x, y: rect.bottom, anchor});
    submenu([
      {label: 'Move to', icon: 'split', execute: () => submenu(TOOL_SLOTS.map(slot => ({label: `Move to ${SLOT_LABELS[slot]}`, icon: tool.anchor === slot ? 'check' : 'split', execute: () => this.move(id, slot)})))},
      {label: 'View Mode', icon: 'settings', execute: () => submenu([
        ['docked', 'Dock Pinned'], ['unpinned', 'Dock Unpinned'], ['sliding', 'Undock (Sliding)'], ['floating', 'Float']
      ].map(([mode, label]) => ({label, icon: tool.mode === mode ? 'check' : null, execute: () => this.setMode(id, mode)})))},
      {label: this.maximized === id ? 'Restore Tool Window Size' : 'Maximize Tool Window', icon: 'fit', shortcut: 'Ctrl+Shift+Quote', execute: () => this.maximize(id)},
      {label: 'Hide Tool Window', icon: 'minus', shortcut: 'Shift+Esc', execute: () => this.hide(id)},
      {label: 'Remove from Sidebar', execute: () => { this.state.setSidebar(id, false); this.maximized = null; this.changed(); this.focusEditor(); }},
      null,
      {label: 'Hide All Tool Windows', shortcut: 'Ctrl+Shift+F12', execute: () => this.hideAll()},
      {label: `${this.state.value.wide ? '✓ ' : ''}Wide Screen Layout`, execute: () => { this.state.value.wide = !this.state.value.wide; this.changed(); }},
      {label: 'Restore Default Layout', icon: 'reset', execute: () => this.reset()}
    ]);
  }
  keydown(event) { return this.input.keydown(event); }
  render() {
    if (this.disposed) return;
    const width = this.root.clientWidth, height = this.root.clientHeight;
    this.geometry = measureToolWindows(this.state.value, width, height, {overlay: this.overlay, maximized: this.maximized});
    const floatingMax = this.maximized && this.state.require(this.maximized).mode === 'floating';
    this.editor.hidden = !!this.maximized && !floatingMax;
    this.position(this.editor, this.geometry.editor);
    this.root.dataset.maximized = this.maximized ?? ''; this.root.dataset.wide = String(this.state.value.wide);
    this.shown.clear();
    for (const side of TOOL_SIDES) {
      const rect = this.geometry.regions[side], host = this.regions.get(side)?.host;
      if (host) { this.position(host, rect); host.hidden = !rect.width || !rect.height; }
    }
    for (const view of this.views.values()) view.next = null;
    for (const item of this.geometry.panels) this.views.get(item.id).next = item;
    for (const [id, tool] of Object.entries(this.state.value.windows)) if (tool.mode === 'floating' && tool.open) {
      const box = id === this.maximized ? {x: 8, y: 8, width: innerWidth - 16, height: innerHeight - 16} : clampToolBox(tool.box, innerWidth, innerHeight);
      this.views.get(id).next = {id, slot: tool.anchor, rect: box, floating: true, overlay: false};
    }
    for (const [id, view] of this.views) {
      const {card, next} = view;
      if (!next || !width || !height) { this.conceal(card); card.classList.remove('floating-tool'); continue; }
      this.shown.add(id); card.hidden = false;
      card.dataset.position = next.slot; card.dataset.mode = this.state.require(id).mode; card.dataset.overlay = String(next.overlay);
      card.classList.toggle('floating-tool', !!next.floating); card.classList.toggle('tool-overlay', next.overlay);
      this.position(card, next.rect);
      if (next.floating && typeof card.showPopover === 'function') {
        card.setAttribute('popover', 'manual'); if (!card.matches(':popover-open')) card.showPopover();
      } else { this.hidePopover(card); card.removeAttribute('popover'); }
      view.resize.hidden = !next.floating || id === this.maximized; view.dock.hidden = !next.floating;
      view.maximize.setAttribute('aria-pressed', String(this.maximized === id));
    }
    const activeDividers = new Set();
    for (const divider of this.geometry.dividers) {
      const key = `${divider.kind}-${divider.side}`, handle = this.dividers.get(key); activeDividers.add(key);
      handle.hidden = false; this.position(handle, divider.rect); handle.setAttribute('aria-valuenow', String(Math.round(divider.value * (divider.kind === 'split' ? 100 : 1))));
    }
    for (const [key, handle] of this.dividers) if (!activeDividers.has(key)) handle.hidden = true;
    this.sidebar?.render(this.shown);
    this.root.dispatchEvent(new CustomEvent('dock-layout', {detail: {shown: [...this.shown]}}));
  }
  position(element, rect) {
    for (const [style, key] of [['left', 'x'], ['top', 'y'], ['width', 'width'], ['height', 'height']]) {
      const value = `${Math.round(rect[key] * 100) / 100}px`; if (element.style[style] !== value) element.style[style] = value;
    }
  }
  hidePopover(element) { if (element.matches?.(':popover-open')) { if (this.frontFloating === element.dataset.toolWindow) this.frontFloating = null; element.hidePopover(); } }
  conceal(card) { this.hidePopover(card); card.hidden = true; }
  dispose() {
    this.disposed = true; this.input.dispose(); this.abort.abort(); this.observer.disconnect(); cancelAnimationFrame(this.pending);
    for (const view of this.views.values()) this.conceal(view.card);
  }
}
