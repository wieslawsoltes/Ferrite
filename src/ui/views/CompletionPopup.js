import {Dom} from './Dom.js';

let sequence = 0;
/** An accessible native-textarea completion list. Document text is never interpreted as HTML. */
export class CompletionPopup {
  constructor(editor) {
    this.editor = editor; this.element = Dom.element('div','editor-completions'); this.element.id = `rust-completions-${++sequence}`;
    this.element.setAttribute('role','listbox'); this.element.setAttribute('aria-label','Rust completions'); this.element.hidden = true;
    document.body.append(this.element); editor.textarea.setAttribute('aria-controls',this.element.id); editor.textarea.setAttribute('aria-autocomplete','list');
    this.outside = event => { if (!this.element.contains(event.target)) this.hide(); };
    document.addEventListener('pointerdown',this.outside); this.resize = () => this.position(); window.addEventListener('resize',this.resize);
  }
  show(items, accept) {
    this.hide(); if (!items.length) return;
    this.items = items.slice(0,100); this.accept = accept; this.element.replaceChildren();
    for (const [index,item] of this.items.entries()) {
      const row = Dom.element('div','editor-completion-option'); row.id = `${this.element.id}-${index}`; row.setAttribute('role','option'); row.title = item.detail;
      row.append(Dom.element('span','editor-completion-label',item.label),Dom.element('small','',item.detail));
      row.onpointerdown = event => { event.preventDefault(); event.stopPropagation(); this.choose(index); }; this.element.append(row);
    }
    this.element.hidden = false; this.select(0); this.position();
  }
  select(index) {
    this.index = (index + this.items.length) % this.items.length;
    for (const [i,row] of [...this.element.children].entries()) row.setAttribute('aria-selected',String(i === this.index));
    const row = this.element.children[this.index]; this.editor.textarea.setAttribute('aria-activedescendant',row.id); row.scrollIntoView({block:'nearest'});
  }
  choose(index = this.index) { const item = this.items?.[index], accept = this.accept; this.hide(); if (item) accept(item); }
  keydown(event) {
    if (this.element.hidden || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)) { if (['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)) this.hide(); return false; }
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') this.hide();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') this.select(this.index + (event.key === 'ArrowDown' ? 1 : -1));
    else this.choose();
    return true;
  }
  position() {
    if (this.element.hidden) return;
    const input = this.editor.textarea, rect = input.getBoundingClientRect(), style = getComputedStyle(input), source = this.editor.source;
    const offset = input.selectionStart, point = source.position(offset), line = input.value.slice(source.lines[point.line - 1],offset);
    const canvas = this.canvas ??= document.createElement('canvas'), context = canvas.getContext('2d'); context.font = style.font;
    // Match CSS tab-size and measure Unicode text with the actual editor font.
    const tab = Number.parseInt(style.tabSize) || 4; let column = 0, expanded = '';
    for (const char of line) { const value = char === '\t' ? ' '.repeat(tab - column % tab) : char; expanded += value; column += [...value].length; }
    const x = rect.left + Number.parseFloat(style.paddingLeft) + context.measureText(expanded).width - input.scrollLeft;
    const y = rect.top + Number.parseFloat(style.paddingTop) + point.line * (Number.parseFloat(style.lineHeight) || 22) - input.scrollTop;
    const width = Math.min(540,window.innerWidth - 16); this.element.style.width = width + 'px';
    this.element.style.left = Math.max(8,Math.min(x,window.innerWidth - width - 8)) + 'px';
    this.element.style.top = Math.max(8,Math.min(y,window.innerHeight - this.element.offsetHeight - 8)) + 'px';
  }
  hide() { this.element.hidden = true; this.items = null; this.accept = null; this.editor.textarea.removeAttribute('aria-activedescendant'); }
  dispose() { this.hide(); document.removeEventListener('pointerdown',this.outside); window.removeEventListener('resize',this.resize); this.element.remove(); }
}
