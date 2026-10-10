import {Dom} from './Dom.js';
import {ContextMenu} from './ContextMenu.js';
import {DialogService} from './DialogService.js';

/** Compact main toolbar and named workbench layouts; commands reuse IDE services. */
export class WorkbenchMenu {
  constructor(app) {
    this.app = app; this.layouts = new Map();
    try {
      const text = app.storage?.getItem('ferrite.named-layouts.v1');
      const entries = text && text.length < 1048576 ? JSON.parse(text) : [];
      if (Array.isArray(entries)) for (const entry of entries.slice(0, 20)) {
        if (typeof entry?.name === 'string' && entry.name.trim() && entry.name.length <= 64) {
          try { this.layouts.set(entry.name, app.dock.state.validate(entry.layout)); } catch { /* Skip malformed named layouts. */ }
        }
      }
    } catch { /* Optional browser storage. */ }
    const menu = app.$('main-menu'), layouts = app.$('layout-menu');
    menu.append(Dom.icon('menu')); layouts.append(Dom.icon('split'));
    menu.onclick = () => this.main(menu); layouts.onclick = () => this.layoutMenu(layouts);
  }
  popup(anchor, items) {
    const rect = anchor.getBoundingClientRect();
    ContextMenu.open(items, {x: rect.x, y: rect.bottom, anchor, onError: error => this.app.error(error)});
  }
  main(anchor) {
    const app = this.app, menu = items => this.popup(anchor, items);
    menu([
      {label: 'File', icon: 'folder', execute: () => menu([...app.$('file-actions').children].map(button => ({label: button.textContent.trim(), execute: () => button.click()})))},
      {label: 'Tool Windows', icon: 'split', execute: () => menu(app.dock.definitions.map(panel => ({label: panel.title, icon: panel.icon, execute: () => panel.id === 'ui-studio' ? app.studio.open() : app.dock.open(panel.id)})))},
      {label: 'Run', icon: 'run', execute: () => menu(['check', 'build', 'run', 'debug', 'test'].map(command => ({label: command[0].toUpperCase() + command.slice(1), execute: () => app.compile(command)})))},
      {label: 'Window Layout', icon: 'split', execute: () => this.layoutMenu(anchor)},
      {label: 'Search Everywhere', icon: 'search', shortcut: 'Ctrl+Shift+P', execute: () => app.palette.open()},
      null,
      {label: `${app.$('workspace-actions').hidden ? 'Show' : 'Hide'} Workspace Actions`, execute: () => this.toggleActions()},
      {label: `${app.settings.auto ? 'Disable' : 'Enable'} Auto-check`, execute: () => app.$('auto-check').click()},
      {label: `${app.settings.optimize ? 'Disable' : 'Enable'} MIR Optimization`, execute: () => app.$('optimize').click()},
      {label: 'Connect Native Bridge', execute: () => app.cargo.connect()}
    ]);
  }
  toggleActions() { const nav = this.app.$('workspace-actions'); nav.hidden = !nav.hidden; }
  layoutMenu(anchor) {
    const dock = this.app.dock;
    this.popup(anchor, [
      {label: 'Restore Default Layout', icon: 'reset', execute: () => dock.reset()},
      {label: 'Hide / Restore All Tool Windows', shortcut: 'Ctrl+Shift+F12', execute: () => dock.hideAll()},
      {label: 'Maximize / Restore Tool Window', execute: () => dock.maximize(dock.state.value.lastTool)},
      {label: `${dock.state.value.wide ? 'Disable' : 'Enable'} Wide Screen Layout`, execute: () => { dock.state.value.wide = !dock.state.value.wide; dock.changed(); }},
      null,
      {label: 'Save Layout As…', icon: 'save', execute: () => this.saveAs()},
      ...[...this.layouts.keys()].map(name => ({label: `Restore: ${name}`, execute: () => dock.restore(this.layouts.get(name))})),
      {label: 'Delete Saved Layout…', disabled: !this.layouts.size, execute: () => this.popup(anchor, [...this.layouts.keys()].map(name => ({label: name, execute: () => this.delete(name)})))},
      null,
      {label: 'Show / Hide Workspace Actions', execute: () => this.toggleActions()}
    ]);
  }
  async saveAs() {
    const answer = await DialogService.ask({title: 'Save Window Layout', label: 'Layout name', confirm: 'Save', message: 'Saves tool positions, view modes, sidebar order, split proportions and floating sizes. Editor documents and designer layouts are unchanged.'});
    if (answer === null) return;
    const name = answer.trim();
    if (!name || name.length > 64) throw Error('Use a layout name between 1 and 64 characters.');
    if (!this.layouts.has(name) && this.layouts.size >= 20) throw Error('Delete a saved layout before adding another (maximum 20).');
    if (this.layouts.has(name) && !await DialogService.ask({title: 'Replace Window Layout', message: `Replace “${name}”?`, input: false, confirm: 'Replace'})) return;
    this.layouts.set(name, this.app.dock.state.snapshot()); this.persist();
  }
  async delete(name) {
    if (await DialogService.ask({title: 'Delete Window Layout', message: `Delete “${name}”?`, input: false, danger: true, confirm: 'Delete'})) { this.layouts.delete(name); this.persist(); }
  }
  persist() {
    try { this.app.storage?.setItem('ferrite.named-layouts.v1', JSON.stringify([...this.layouts].map(([name, layout]) => ({name, layout})))); }
    catch { this.app.status('Layout saved for this session; browser storage is unavailable.', 'warning'); }
  }
}
