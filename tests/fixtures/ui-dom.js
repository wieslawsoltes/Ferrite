// Minimal DOM for deterministic reconciler unit tests. Real DOM behavior is tested
// separately in Chromium; this deliberately does not pretend to implement HTML.
class Node extends EventTarget {
  constructor(document, name, type) { super(); this.ownerDocument = document; this.nodeName = name; this.nodeType = type; this.childNodes = []; this.parentNode = null; this.data = ''; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() { if (!this.parentNode) return null; return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
  get textContent() { return this.nodeType === 8 ? '' : this.nodeType === 3 ? this.data : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { if (this.nodeType === 3 || this.nodeType === 8) this.data = String(value); else this.replaceChildren(this.ownerDocument.createTextNode(value)); }
  insertBefore(node, before) { if (node === before) return node; if (before && before.parentNode !== this) throw Error('Invalid reference node'); node.remove(); const index = before ? this.childNodes.indexOf(before) : this.childNodes.length; this.childNodes.splice(index, 0, node); node.parentNode = this; return node; }
  append(...nodes) { for (const node of nodes) this.insertBefore(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node, null); }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i < 0) throw Error('Not a child'); this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...nodes) { for (const node of [...this.childNodes]) node.remove(); this.append(...nodes); }
}
class Element extends Node {
  constructor(document, tag, namespace = 'http://www.w3.org/1999/xhtml') {
    super(document, tag.toUpperCase(), 1); this.localName = tag; this.namespaceURI = namespace; this.attributes = new Map();
    this.style = {cssText: '', setProperty(name, value) { this[name] = value; }};
    if (['input', 'select', 'textarea', 'option'].includes(tag)) { this.value = ''; this.type = ''; this.checked = false; this.selected = false; }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'type') this.type = String(value); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
}
export function createDocument() {
  const document = {
    createElement: tag => new Element(document, tag),
    createElementNS: (namespace, tag) => new Element(document, tag, namespace),
    createTextNode: value => { const node = new Node(document, '#text', 3); node.data = String(value); return node; },
    createComment: value => { const node = new Node(document, '#comment', 8); node.data = String(value); return node; }
  };
  return document;
}
export function descendants(node, predicate) { const result = []; for (const child of node.childNodes) { if (predicate(child)) result.push(child); result.push(...descendants(child, predicate)); } return result; }
export function elements(node, tag) { return descendants(node, child => child.localName === tag); }
