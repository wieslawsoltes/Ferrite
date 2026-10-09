import {ViewSyntax, rustString} from './ViewSyntax.js';
import {UICompiler} from './UICompiler.js';

/** Source is authoritative. Every edit is range-based, revision-checked and atomic. */
export class SourceDesigner {
  constructor(source, {file = 'src/app.ui.rs', entry = 'app', revision = 0, validate = true, maxHistory = 50, files = {}, entryFile = file} = {}) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw Error('Invalid designer revision');
    this.files = files; this.entryFile = entryFile;
    this.file = file; this.entry = entry; this.revision = revision; this.validate = validate;
    this.maxHistory = Math.max(0, Math.min(50, maxHistory)); this.history = []; this.future = [];
    this.load(source);
  }
  load(source) {
    const syntax = new ViewSyntax(source, {file: this.file}), expansion = syntax.expand();
    this.source = source; this.syntax = syntax; this.nodes = expansion.nodes;
    this.index = new Map(this.nodes.map(node => [node.id, node]));
    this.parents = new Map();
    for (const node of this.nodes) for (const child of node.children ?? []) this.parents.set(child.id, node);
  }
  assertRevision(expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== this.revision) throw Object.assign(Error('Designer source changed; inspect the current revision before editing'), {code: 'F_UI_REVISION'});
  }
  node(id) { const node = this.index.get(id); if (!node) throw Error('Unknown or stale source node'); return node; }
  snapshot() {
    return {file: this.file, entry: this.entry, revision: this.revision, source: this.source,
      nodes: this.nodes.map(node => ({...node, parent: this.parents.get(node.id)?.id ?? null, children: node.children?.map(child => child.id)})),
      canUndo: !!this.history.length, canRedo: !!this.future.length};
  }
  validateSource(source) {
    const syntax = new ViewSyntax(source, {file: this.file}); syntax.expand();
    if (this.validate) UICompiler.compile(this.entryFile === this.file ? source : this.files[this.entryFile], {file: this.entryFile, entry: this.entry, files: {...this.files, [this.file]: source}});
  }
  commit(source, label) {
    if (source === this.source) return this.snapshot();
    this.validateSource(source);
    this.history.push({before: this.source, after: source, label}); this.future = [];
    let bytes = this.history.reduce((n, item) => n + item.before.length + item.after.length, 0);
    while (this.history.length > this.maxHistory || bytes > 4_000_000) {
      const removed = this.history.shift(); bytes -= removed.before.length + removed.after.length;
    }
    this.load(source); this.revision++; return this.snapshot();
  }
  undo(expectedRevision) {
    this.assertRevision(expectedRevision); const transaction = this.history.at(-1);
    if (!transaction) return this.snapshot();
    if (this.source !== transaction.after) throw Error('Undo would overwrite newer source');
    this.history.pop(); this.future.push(transaction); this.load(transaction.before); this.revision++; return this.snapshot();
  }
  redo(expectedRevision) {
    this.assertRevision(expectedRevision); const transaction = this.future.at(-1);
    if (!transaction) return this.snapshot();
    if (this.source !== transaction.before) throw Error('Redo would overwrite newer source');
    this.future.pop(); this.history.push(transaction); this.load(transaction.after); this.revision++; return this.snapshot();
  }
  insertion(parent, before, markup) {
    if (parent.kind !== 'element') throw Error('Insert into an element or fragment');
    if (before != null && !parent.children.some(child => child.id === before)) throw Error('Insertion anchor must be a direct child of the destination');
    if (parent.selfClosing) return {start: parent.openEnd - 2, end: parent.openEnd, text: `>${markup}</${parent.tag}>`};
    const at = before == null ? parent.closeStart : this.node(before).start;
    return {start: at, end: at, text: markup};
  }
  apply(operation, expectedRevision) {
    this.assertRevision(expectedRevision);
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw Error('Expected one designer operation');
    const node = this.node(operation.node), edits = [];
    const replace = (start, end, text) => edits.push({start, end, text});
    const requireElement = () => { if (node.kind !== 'element' || !node.tag) throw Error('Select a named element'); };
    const attributeName = () => { if (typeof operation.name !== 'string' || !/^[A-Za-z_][\w:.-]{0,79}$/.test(operation.name)) throw Error('Invalid attribute name'); return operation.name; };
    switch (operation.op) {
      case 'setAttribute': {
        requireElement(); const name = attributeName(), kind = operation.kind ?? 'string';
        if (!['string', 'expression', 'boolean'].includes(kind)) throw Error('Attribute kind must be string, expression or boolean');
        if (kind !== 'boolean' && (typeof operation.value !== 'string' || operation.value.length > 64000)) throw Error('Attribute value must be bounded text');
        const value = kind === 'boolean' ? name : `${name}=${kind === 'string' ? rustString(operation.value) : `{${operation.value}}`}`;
        const attribute = node.attributes.find(item => item.name === name);
        if (attribute) replace(attribute.start, attribute.end, value); else replace(node.tagEnd, node.tagEnd, ' ' + value);
        break;
      }
      case 'removeAttribute': {
        requireElement(); const attribute = node.attributes.find(item => item.name === attributeName());
        if (!attribute) throw Error('Attribute does not exist');
        replace(attribute.start, attribute.end, ''); break;
      }
      case 'setText': {
        if (node.kind !== 'text' && node.kind !== 'expression') throw Error('Select a text or expression node');
        if (typeof operation.value !== 'string' || operation.value.length > 64000) throw Error('Text must be bounded');
        // Rust string expression cannot become markup or a new view! invocation.
        replace(node.start, node.end, `{${rustString(operation.value)}}`); break;
      }
      case 'setTag': {
        requireElement(); const tag = operation.value;
        if (typeof tag !== 'string' || !/^[A-Za-z_][\w:.-]{0,79}$/.test(tag)) throw Error('Invalid tag name');
        replace(node.start + 1, node.tagEnd, tag);
        if (!node.selfClosing) replace(node.closeStart + 2, node.closeStart + 2 + node.tag.length, tag);
        break;
      }
      case 'insert': {
        if (typeof operation.markup !== 'string' || !operation.markup.trim() || operation.markup.length > 64000) throw Error('Insert requires bounded markup');
        edits.push(this.insertion(node, operation.before, operation.markup)); break;
      }
      case 'remove': case 'duplicate': {
        if (!this.parents.has(node.id)) throw Error('A view! root cannot be removed or duplicated');
        if (operation.op === 'remove') replace(node.start, node.end, '');
        else replace(node.end, node.end, this.source.slice(node.start, node.end));
        break;
      }
      case 'move': {
        if (!this.parents.has(node.id)) throw Error('A view! root cannot be moved');
        const parent = this.node(operation.parent);
        if (parent.start >= node.start && parent.end <= node.end) throw Error('A node cannot be moved into itself or a descendant');
        if (operation.before === node.id && this.parents.get(node.id) === parent) return this.snapshot();
        edits.push(this.insertion(parent, operation.before, this.source.slice(node.start, node.end)));
        replace(node.start, node.end, ''); break;
      }
      default: throw Error('Unknown designer operation');
    }
    edits.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end) throw Error('Designer edits overlap');
    let source = this.source;
    for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return this.commit(source, operation.op);
  }
}
