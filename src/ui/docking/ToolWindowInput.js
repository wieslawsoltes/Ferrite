import {Dom} from '../views/Dom.js';
import {ContextMenu} from '../views/ContextMenu.js';
import {ToolWindowState, SLOT_LABELS, DEFAULT_SIZES, clampToolBox} from './ToolWindowState.js';
import {measureToolWindows, toolDropTargets, containsPoint} from './ToolWindowGeometry.js';

const MIME = 'application/x-ferrite-tool';

/** Pointer capture, keyboard commands and cancellation form one docking transaction. */
export class ToolWindowInput {
  constructor(dock) {
    this.dock = dock; this.drag = null;
    const signal = dock.abort.signal;
    this.shield = Dom.element('div', 'tool-drag-overlay'); this.shield.setAttribute('popover', 'manual'); this.shield.hidden = true;
    this.guide = Dom.element('div', 'tool-drop-preview'); this.label = Dom.element('div', 'tool-drag-label');
    this.targets = Dom.element('div', 'tool-drop-targets'); this.shield.append(this.guide, this.targets, this.label); dock.root.append(this.shield);
    document.addEventListener('pointermove', event => this.update(event), {capture: true, signal});
    document.addEventListener('pointerup', event => { if (this.drag?.pointerId === event.pointerId) this.finish(false, event); }, {capture: true, signal});
    document.addEventListener('pointercancel', event => { if (this.drag?.pointerId === event.pointerId) this.finish(true); }, {capture: true, signal});
    document.addEventListener('keydown', event => {
      if (this.drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.finish(true); }
    }, {capture: true, signal});
    document.addEventListener('pointerdown', () => { this.suppressUntil = 0; this.suppressElement = null; }, {capture: true, signal});
    document.addEventListener('click', event => {
      if (performance.now() < (this.suppressUntil ?? 0) && this.suppressElement?.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, {capture: true, signal});
    window.addEventListener('blur', () => this.finish(true), {signal});
  }
  handle(element, id) {
    element.addEventListener('pointerdown', event => {
      if (event.target.closest('.tool-window-actions,.tool-window-selector')) return;
      this.begin(event, element, {kind: 'move', id});
    }, {signal: this.dock.abort.signal});
    element.addEventListener('dragstart', event => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData(MIME, id); event.dataTransfer.effectAllowed = 'move';
    }, {signal: this.dock.abort.signal});
  }
  acceptDrop(element, destination) {
    const signal = this.dock.abort.signal;
    element.addEventListener('dragover', event => {
      if (event.dataTransfer?.types.includes(MIME)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; element.classList.add('tool-drop-hover'); }
    }, {signal});
    element.addEventListener('dragleave', () => element.classList.remove('tool-drop-hover'), {signal});
    element.addEventListener('drop', event => {
      element.classList.remove('tool-drop-hover'); const id = event.dataTransfer?.getData(MIME);
      if (!this.dock.panels.has(id)) return;
      event.preventDefault(); event.stopPropagation(); this.finish(true);
      const target = destination(); this.dock.move(id, target.slot, target.before ?? null);
    }, {signal});
  }
  splitter(element, kind, side) {
    const signal = this.dock.abort.signal;
    element.addEventListener('pointerdown', event => this.begin(event, element, {kind, side}), {signal});
    element.addEventListener('dblclick', () => {
      if (kind === 'split') this.dock.state.setSplit(side, .5); else this.dock.state.setSize(side, DEFAULT_SIZES[side]);
      this.dock.changed();
    }, {signal});
    element.addEventListener('keydown', event => {
      const positive = kind === 'split' ? (side === 'bottom' ? 'ArrowRight' : 'ArrowDown') : side === 'left' ? 'ArrowRight' : side === 'right' ? 'ArrowLeft' : 'ArrowUp';
      const negative = kind === 'split' ? (side === 'bottom' ? 'ArrowLeft' : 'ArrowUp') : side === 'left' ? 'ArrowLeft' : side === 'right' ? 'ArrowRight' : 'ArrowDown';
      if (![positive, negative, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const delta = (event.key === positive ? 1 : -1) * (event.shiftKey ? 50 : 20);
      if (kind === 'split') this.dock.state.setSplit(side, event.key === 'Home' ? .15 : event.key === 'End' ? .85 : this.dock.state.value.splits[side] + delta / 500);
      else this.dock.state.setSize(side, event.key === 'Home' ? (side === 'bottom' ? 120 : 180) : event.key === 'End' ? Math.max(180, (side === 'bottom' ? this.dock.root.clientHeight : this.dock.root.clientWidth) * .6) : this.dock.state.value.sizes[side] + delta);
      this.dock.changed();
    }, {signal});
  }
  floatResize(element, id) {
    element.addEventListener('pointerdown', event => this.begin(event, element, {kind: 'float-resize', id}), {signal: this.dock.abort.signal});
    element.addEventListener('keydown', event => {
      if (!event.key.startsWith('Arrow')) return;
      event.preventDefault(); event.stopPropagation(); const box = this.dock.state.require(id).box, step = event.shiftKey ? 40 : 10;
      this.dock.state.setBox(id, {width: box.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), height: box.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)}); this.dock.changed();
    }, {signal: this.dock.abort.signal});
  }
  begin(event, element, details) {
    if (event.button !== 0 || event.isPrimary === false || this.drag) return;
    const dock = this.dock, rect = details.id ? dock.views.get(details.id).card.getBoundingClientRect() : null;
    const divider = details.side ? dock.geometry.dividers.find(item => item.kind === details.kind && item.side === details.side) : null;
    this.drag = {...details, element, pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, snapshot: dock.state.snapshot(), overlay: dock.overlay, maximized: dock.maximized, rect, divider, active: details.kind !== 'move'};
    if (details.kind !== 'move') { event.preventDefault(); document.body.classList.add('tool-resizing'); }
    element.setPointerCapture(event.pointerId);
    element.addEventListener('lostpointercapture', () => { if (this.drag?.element === element) this.finish(true); }, {once: true, signal: dock.abort.signal});
  }
  update(event) {
    const drag = this.drag; if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX; drag.lastY = event.clientY;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y, dock = this.dock;
    if (!drag.active && Math.hypot(dx, dy) < 5) return;
    if (!drag.active) {
      drag.active = true; ContextMenu.current?.(false); document.body.classList.add('tool-dragging'); this.shield.hidden = false;
      if (typeof this.shield.showPopover === 'function') this.shield.showPopover();
      const bounds = dock.root.getBoundingClientRect(); this.targets.replaceChildren();
      for (const rect of toolDropTargets(bounds.width, bounds.height)) {
        const target = Dom.element('div', 'tool-drop-target', SLOT_LABELS[rect.slot]); target.dataset.dropSlot = rect.slot;
        dock.position(target, {...rect, x: rect.x + bounds.x, y: rect.y + bounds.y}); this.targets.append(target);
      }
    }
    event.preventDefault();
    if (drag.kind === 'size') {
      dock.state.setSize(drag.side, drag.divider.value + (drag.side === 'left' ? dx : drag.side === 'right' ? -dx : -dy)); dock.render();
    } else if (drag.kind === 'split') {
      const bounds = drag.divider.bounds, horizontal = drag.side === 'bottom';
      dock.state.setSplit(drag.side, drag.snapshot.splits[drag.side] + (horizontal ? dx : dy) / Math.max(1, (horizontal ? bounds.width : bounds.height) - 1)); dock.render();
    } else if (drag.kind === 'float-resize') {
      dock.state.setBox(drag.id, {width: drag.rect.width + dx, height: drag.rect.height + dy}); dock.render();
    } else {
      drag.target = this.destination(event.clientX, event.clientY);
      this.preview(drag);
    }
  }
  destination(x, y) {
    const dock = this.dock, bounds = dock.root.getBoundingClientRect();
    for (const element of document.elementsFromPoint(x, y)) {
      const button = element.closest?.('[data-tool]');
      if (button && dock.panels.has(button.dataset.tool)) return {slot: dock.state.require(button.dataset.tool).anchor, before: button.dataset.tool};
      const group = element.closest?.('[data-tool-slot]');
      if (group && dock.sidebar?.groups.get(group.dataset.toolSlot) === group) return {slot: group.dataset.toolSlot};
    }
    if (!containsPoint(bounds, x, y)) return null;
    const localX = x - bounds.x, localY = y - bounds.y;
    const explicit = toolDropTargets(bounds.width, bounds.height).find(rect => containsPoint(rect, localX, localY));
    if (explicit) return {slot: explicit.slot};
    if (localY > bounds.height - 42) return {slot: localX < bounds.width / 2 ? 'bottom-left' : 'bottom-right'};
    if (localX < 42) return {slot: localY < bounds.height / 2 ? 'left-top' : 'left-bottom'};
    if (localX > bounds.width - 42) return {slot: localY < bounds.height / 2 ? 'right-top' : 'right-bottom'};
    const item = dock.geometry.panels.find(item => containsPoint(item.rect, localX, localY));
    return item ? {slot: item.slot, before: item.id === this.drag.id ? item.id : null} : null;
  }
  freeBox(drag) {
    const floating = drag.snapshot.windows[drag.id].mode === 'floating';
    const width = floating ? drag.rect.width : Math.min(680, Math.max(360, drag.rect.width || 520));
    const height = floating ? drag.rect.height : Math.min(600, Math.max(280, drag.rect.height || 440));
    const offset = drag.element.closest('.tool-rail') ? Math.min(width / 2, 80) : Math.min(width - 24, Math.max(24, drag.x - drag.rect.x));
    return clampToolBox({x: drag.lastX - offset, y: drag.lastY - Math.min(20, Math.max(0, drag.y - drag.rect.y)), width, height}, innerWidth, innerHeight);
  }
  preview(drag) {
    const dock = this.dock, bounds = dock.root.getBoundingClientRect(); let rect;
    if (drag.target) {
      const model = new ToolWindowState(dock.panels.keys(), drag.snapshot); model.move(drag.id, drag.target.slot, drag.target.before ?? null);
      const projected = measureToolWindows(model.value, bounds.width, bounds.height, {overlay: drag.id});
      rect = projected.panels.find(item => item.id === drag.id)?.rect;
      if (rect) rect = {...rect, x: rect.x + bounds.x, y: rect.y + bounds.y};
    }
    rect ??= this.freeBox(drag); dock.position(this.guide, rect);
    this.label.textContent = `${dock.panels.get(drag.id).title} → ${drag.target ? SLOT_LABELS[drag.target.slot] : 'Float'} · Esc to cancel`;
    dock.position(this.label, {x: Math.max(8, Math.min(innerWidth - 260, drag.lastX + 16)), y: Math.min(innerHeight - 40, drag.lastY + 22), width: Math.min(320, innerWidth - 16), height: 30});
    for (const target of this.targets.children) target.classList.toggle('active', target.dataset.dropSlot === drag.target?.slot);
  }
  finish(cancel = false, event = null) {
    const drag = this.drag; if (!drag) return; this.drag = null;
    if (event) { drag.lastX = event.clientX; drag.lastY = event.clientY; }
    try { if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId); } catch { /* Lost window focus/capture. */ }
    document.body.classList.remove('tool-dragging', 'tool-resizing'); this.dock.hidePopover(this.shield); this.shield.hidden = true;
    if (!drag.active) return;
    this.suppressUntil = performance.now() + 500; this.suppressElement = drag.element;
    if (cancel) {
      this.dock.state.restore(drag.snapshot); this.dock.overlay = drag.overlay; this.dock.maximized = drag.maximized; this.dock.render(); return;
    }
    if (drag.kind === 'move') {
      if (drag.target) this.dock.move(drag.id, drag.target.slot, drag.target.before ?? null);
      else this.dock.float(drag.id, this.freeBox(drag));
    } else this.dock.changed();
  }
  keydown(event) {
    const dock = this.dock, modifier = event.ctrlKey || event.metaKey;
    const focused = document.activeElement?.closest?.('[data-tool-window]')?.dataset.toolWindow;
    const id = focused ?? dock.state.value.lastTool;
    let action;
    if (modifier && event.shiftKey && event.key === 'F12') action = () => dock.hideAll();
    else if (event.altKey && !modifier && event.key === 'F12') action = () => dock.toggle('terminal');
    else if (event.altKey && !modifier && !event.shiftKey) {
      const tool = {Digit1: 'project', Digit4: 'run', Digit5: 'debugger', Digit6: 'problems', Digit7: 'structure', Digit9: 'repositories'}[event.code];
      if (tool && dock.panels.has(tool)) action = () => dock.toggle(tool);
    } else if (!modifier && !event.altKey && !event.shiftKey && event.key === 'F12') action = () => dock.open(id);
    else if (event.shiftKey && !modifier && event.key === 'Escape') action = () => dock.hide(id);
    else if (modifier && event.shiftKey && event.code === 'Quote') action = () => dock.maximize(id);
    else if (event.key === 'Escape' && focused && focused !== 'terminal' && !event.target.closest('.panel-dock')) action = () => {
      if (['sliding', 'unpinned'].includes(dock.state.require(focused).mode)) dock.hide(focused); else dock.focusEditor();
    };
    if (!action) return false;
    event.preventDefault(); action(); return true;
  }
  dispose() { this.finish(true); this.shield.remove(); }
}
