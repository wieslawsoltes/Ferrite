import {Dom} from './Dom.js';

export class CommandPalette {
  constructor(getCommands) {
    this.getCommands = getCommands;
    this.dialog = Dom.element('dialog', 'command-dialog');
    this.dialog.setAttribute('aria-label', 'Search Everywhere');
    this.input = Dom.element('input', 'command-search');
    this.input.placeholder = 'Search Everywhere — files, commands, compiler stages';
    this.input.setAttribute('aria-label', 'Search Everywhere');
    this.list = Dom.element('div', 'command-list');
    this.dialog.append(this.input, this.list);
    document.body.append(this.dialog);
    this.input.oninput = () => this.render();
    this.input.onkeydown = event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.index = Math.max(0, Math.min(this.results.length - 1, this.index + (event.key === 'ArrowDown' ? 1 : -1)));
        this.mark();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.choose(this.index);
      }
    };
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); });
    // Agent and terminal panes deliberately stop bubbling keyboard events. Reserve
    // only Search Everywhere before those panes (and xterm) consume the key;
    // shell editing, ncurses function keys and application shortcuts remain local.
    this.document = this.dialog.ownerDocument;
    this.shortcut = event => this.handleShortcut(event);
    this.document.addEventListener('keydown', this.shortcut, {capture: true});
  }
  handleShortcut(event) {
    if (this.disposed || event.defaultPrevented || event.isComposing || event.altKey ||
        !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'p' ||
        event.target?.closest?.('dialog')) return false;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) this.open();
    return true;
  }
  open(query = '') {
    if (this.disposed) return;
    this.input.value = query;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
    this.input.focus();
  }
  render() {
    const query = this.input.value.trim().toLowerCase();
    this.results = this.getCommands().filter(item => !query || item.label.toLowerCase().includes(query)).slice(0, 50);
    this.index = 0;
    this.list.replaceChildren();
    this.results.forEach((item, index) => {
      const button = Dom.button(item.label, () => this.choose(index), {icon: item.icon ?? 'right', className: 'command-item'});
      if (item.shortcut) button.append(Dom.element('kbd', '', item.shortcut));
      this.list.append(button);
    });
    this.mark();
  }
  mark() {
    [...this.list.children].forEach((node, index) => node.classList.toggle('active', index === this.index));
    this.list.children[this.index]?.scrollIntoView({block: 'nearest'});
  }
  choose(index) {
    const item = this.results[index];
    if (!item) return;
    this.dialog.close();
    item.execute();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.document.removeEventListener('keydown', this.shortcut, {capture: true});
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
  }
}
