/** Bounded DOM sink for server rendering. It never parses HTML or executes events. */
export class ServerDocument {
  constructor({maxNodes = 50000} = {}) {
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 200000) throw Error('Invalid server node budget');
    this.maxNodes = maxNodes; this.nodes = 0;
    const document = this, html = 'http://www.w3.org/1999/xhtml';
    class Node {
      constructor(name, type, data = '') {
        if (++document.nodes > document.maxNodes) throw Error('Server DOM node budget exceeded');
        this.ownerDocument = document; this.nodeName = name; this.nodeType = type; this.data = String(data);
        this.parentNode = null; this.childNodes = [];
      }
      get firstChild() { return this.childNodes[0] ?? null; }
      get lastChild() { return this.childNodes.at(-1) ?? null; }
      get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
      get textContent() { return this.nodeType === 8 ? '' : this.nodeType === 3 ? this.data : this.childNodes.map(n => n.textContent).join(''); }
      set textContent(value) { if (this.nodeType === 3 || this.nodeType === 8) this.data = String(value); else this.replaceChildren(document.createTextNode(value)); }
      insertBefore(node, before) {
        if (node === before) return node;
        if (before && before.parentNode !== this) throw Error('Invalid server insertion anchor');
        for (let parent = this; parent; parent = parent.parentNode) if (parent === node) throw Error('Cyclic server DOM');
        node.remove(); this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, node); node.parentNode = this; return node;
      }
      append(...nodes) { for (const node of nodes) this.insertBefore(typeof node === 'string' ? document.createTextNode(node) : node, null); }
      removeChild(node) { const index = this.childNodes.indexOf(node); if (index < 0) throw Error('Not a server child'); this.childNodes.splice(index, 1); node.parentNode = null; return node; }
      remove() { this.parentNode?.removeChild(this); }
      replaceChildren(...nodes) { for (const node of [...this.childNodes]) node.remove(); this.append(...nodes); }
    }
    class Element extends Node {
      constructor(tag, namespace) {
        super(namespace === html ? tag.toUpperCase() : tag, 1); this.localName = namespace === html ? tag.toLowerCase() : tag; this.namespaceURI = namespace;
        this.attributes = new Map(); this.listeners = new Map(); this.type = '';
        const styles = new Map(); let css = '';
        const cssName = name => name.startsWith('--') ? name : name.replace(/^ms-/, '-ms-').replace(/[A-Z]/g, c => '-' + c.toLowerCase());
        const style = {
          get cssText() { return css + [...styles].map(([name, value]) => `${name}: ${value};`).join(' '); },
          set cssText(value) { css = String(value); styles.clear(); },
          setProperty(name, value) {
            if (!/^(--[\w-]+|[a-zA-Z-]+)$/.test(name)) throw Error('Invalid server CSS property');
            if (value === '') styles.delete(name); else styles.set(name, String(value));
          }
        };
        this.style = new Proxy(style, {
          set(target, name, value) { if (name === 'cssText') target.cssText = value; else target.setProperty(cssName(String(name)), value); return true; },
          get(target, name) { return name in target ? target[name] : styles.get(cssName(String(name))) ?? ''; }
        });
        if (['input', 'textarea', 'select', 'option'].includes(this.localName)) { this.value = undefined; this.checked = undefined; this.selected = undefined; this.defaultValue = undefined; this.defaultChecked = undefined; }
        if (['video', 'audio'].includes(this.localName)) this.muted = undefined;
      }
      setAttribute(name, value) {
        if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name)) throw Error('Invalid server attribute name');
        if (this.namespaceURI === html) name = name.toLowerCase(); this.attributes.set(name, String(value)); if (name === 'type') this.type = String(value);
      }
      removeAttribute(name) { this.attributes.delete(this.namespaceURI === html ? name.toLowerCase() : name); }
      getAttribute(name) { return this.attributes.get(this.namespaceURI === html ? name.toLowerCase() : name) ?? null; }
      hasAttribute(name) { return this.getAttribute(name) !== null; }
      addEventListener(name, callback, capture) { this.listeners.set(callback, {name, capture}); }
      removeEventListener(_name, callback) { this.listeners.delete(callback); }
      focus() { throw Error('Cannot focus a DOM element during server rendering'); }
    }
    this.createElement = tag => new Element(String(tag), html);
    this.createElementNS = (namespace, tag) => new Element(String(tag), namespace);
    this.createTextNode = value => new Node('#text', 3, value);
    this.createComment = value => new Node('#comment', 8, value);
  }
  serialize(container, {staticMarkup = false, maxLength = 10000000} = {}) {
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 50000000) throw Error('Invalid server output budget');
    let length = 0; const parts = [], html = 'http://www.w3.org/1999/xhtml';
    const write = value => { length += value.length; if (length > maxLength) throw Error('Server HTML output budget exceeded'); parts.push(value); };
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'}[c]));
    const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
    const visit = (node, depth = 0, selectValue) => {
      if (depth > 256) throw Error('Server HTML depth exceeded');
      if (node.nodeType === 3) { write(escape(node.data)); return; }
      if (node.nodeType === 8) { if (!staticMarkup) { if (/--|[<>]/.test(node.data)) throw Error('Invalid server comment'); write(`<!--${node.data}-->`); } return; }
      if (node.nodeType !== 1) throw Error('Unsupported server DOM node');
      const tag = node.localName, attributes = new Map(node.attributes), isHtml = node.namespaceURI === html;
      if (node.style.cssText) attributes.set('style', node.style.cssText);
      if (isHtml && tag === 'input') {
        const value = node.value ?? node.defaultValue; if (value != null) attributes.set('value', String(value));
        if (node.checked ?? node.defaultChecked) attributes.set('checked', '');
      }
      if (isHtml && ['audio', 'video'].includes(tag) && node.muted) attributes.set('muted', '');
      if (isHtml && tag === 'option' && node.value !== undefined) attributes.set('value', String(node.value));
      if (isHtml && tag === 'select') selectValue = node.value ?? node.defaultValue;
      if (isHtml && tag === 'option' && (node.selected || selectValue !== undefined && String(selectValue) === String(node.value ?? attributes.get('value') ?? node.textContent))) attributes.set('selected', '');
      write('<' + tag); for (const [name, value] of attributes) write(` ${name}="${escape(value)}"`); write('>');
      if (isHtml && voidTags.has(tag)) { if (node.childNodes.length) throw Error(`Void element ${tag} cannot have server-rendered children`); return; }
      if (isHtml && tag === 'textarea') {
        const value = String(node.value ?? node.defaultValue ?? node.textContent);
        if (value.startsWith('\n')) write('\n'); write(escape(value));
      } else {
        if (isHtml && ['pre', 'listing'].includes(tag) && node.firstChild?.nodeType === 3 && node.firstChild.data.startsWith('\n')) write('\n');
        for (const child of node.childNodes) visit(child, depth + 1, selectValue);
      }
      write('</' + tag + '>');
    };
    for (const node of container.childNodes) visit(node); return parts.join('');
  }
}
