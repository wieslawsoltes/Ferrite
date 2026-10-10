import {Dom} from '../views/Dom.js';
import {ContextMenu} from '../views/ContextMenu.js';
import {TOOL_SLOTS, SLOT_LABELS, TOOL_SHORTCUTS} from './ToolWindowState.js';

/** Sidebar ownership follows the docking model, never a second hard-coded list. */
export class ToolWindowSidebar {
  constructor(dock, {left, right, open = id => dock.toggle(id)}) {
    this.dock = dock; this.groups = new Map(); this.buttons = new Map(); this.roots = [left, right];
    for (const [side, root] of [['left', left], ['right', right]]) {
      root.replaceChildren(); root.setAttribute('aria-label', `${side === 'left' ? 'Left' : 'Right'} tool window bar`);
      const top = Dom.element('div', 'rail-stack'), bottom = Dom.element('div', 'rail-stack rail-stack-bottom');
      for (const slot of [`${side}-top`, `${side}-bottom`, `bottom-${side}`]) {
        const group = Dom.element('div', 'rail-group'); group.dataset.toolSlot = slot;
        group.setAttribute('role', 'group'); group.setAttribute('aria-label', `${SLOT_LABELS[slot]} tool windows`);
        (slot.startsWith('bottom-') ? bottom : top).append(group); this.groups.set(slot, group);
        dock.acceptDrop(group, () => ({slot}));
      }
      if (side === 'left') {
        const more = Dom.button('', () => this.menu(more), {icon: 'menu', className: 'rail-button rail-more', title: 'More Tool Windows'});
        more.setAttribute('aria-label', 'More Tool Windows'); more.setAttribute('aria-haspopup', 'menu'); top.append(more);
      }
      root.append(top, Dom.element('div', 'rail-spacer'), bottom);
      root.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...root.querySelectorAll('button')].filter(button => !button.hidden && button.getClientRects().length);
        const index = buttons.indexOf(document.activeElement);
        if (index < 0 || !buttons.length) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }, {signal: dock.abort.signal});
    }
    for (const panel of dock.definitions) {
      const button = Dom.button('', () => open(panel.id), {icon: panel.icon, className: 'rail-button', title: `${panel.title} tool window`});
      button.dataset.tool = panel.id;
      button.setAttribute('aria-label', `${panel.title} tool window`);
      button.setAttribute('aria-controls', dock.views.get(panel.id).card.id);
      button.setAttribute('aria-haspopup', 'menu');
      button.addEventListener('contextmenu', event => { event.preventDefault(); dock.panelMenu(panel.id, button); }, {signal: dock.abort.signal});
      button.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); dock.panelMenu(panel.id, button); }
      }, {signal: dock.abort.signal});
      dock.dragHandle(button, panel.id);
      dock.acceptDrop(button, () => ({slot: dock.state.require(panel.id).anchor, before: panel.id}));
      this.buttons.set(panel.id, button);
    }
  }
  menu(anchor) {
    const rect = anchor.getBoundingClientRect();
    ContextMenu.open(this.dock.definitions.map(panel => ({label: panel.title, icon: panel.icon, shortcut: TOOL_SHORTCUTS[panel.id], execute: () => this.dock.open(panel.id)})), {x: rect.right, y: rect.top, anchor});
  }
  render(shown) {
    const state = this.dock.state.value;
    for (const slot of TOOL_SLOTS) {
      const group = this.groups.get(slot);
      for (const [index, id] of state.slots[slot].order.entries()) {
        const button = this.buttons.get(id), tool = state.windows[id];
        if (group.children[index] !== button) group.insertBefore(button, group.children[index] ?? null);
        button.hidden = !tool.sidebar;
        button.classList.toggle('active', shown.has(id));
        button.classList.toggle('rail-floating', tool.mode === 'floating');
        button.setAttribute('aria-pressed', String(shown.has(id)));
        button.title = `${this.dock.panels.get(id).title}${TOOL_SHORTCUTS[id] ? ` (${TOOL_SHORTCUTS[id]})` : ''} · ${SLOT_LABELS[slot]}`;
      }
      group.hidden = !state.slots[slot].order.some(id => state.windows[id].sidebar);
    }
  }
}
