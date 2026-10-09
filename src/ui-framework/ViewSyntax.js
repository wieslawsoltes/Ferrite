import {Diagnostic} from '../compiler/Diagnostic.js';
import {Lexer} from '../compiler/Lexer.js';

/** Rust literal spelling, not JavaScript's incompatible \\uXXXX escape spelling. */
export function rustString(value) {
  return '"' + String(value).replace(/["\\\u0000-\u001f\u007f]/g, c => ({'"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\0': '\\0'})[c] ?? `\\u{${c.codePointAt(0).toString(16)}}`) + '"';
}

/** A bounded source scanner shared by markup parsing, expansion and visual editing. */
export class ViewSyntax {
  constructor(source, {file = 'src/ui.rs', maxNodes = 10000} = {}) {
    if (typeof source !== 'string' || source.length > 512000) throw new Diagnostic('F_UI_SIZE', 'UI source must be text of at most 512,000 UTF-16 units');
    this.source = source; this.file = file; this.maxNodes = maxNodes; this.nodes = []; this.macros = []; this.sequence = 0;
    this.prefix = '__ferrite_view'; while (source.includes(this.prefix)) this.prefix += '_';
    this.lines = [0]; for (let i = 0; i < source.length; i++) if (source[i] === '\n') this.lines.push(i + 1);
  }
  span(start, end = start + 1) {
    const position = offset => { let lo = 0, hi = this.lines.length; while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (this.lines[mid] <= offset) lo = mid; else hi = mid; } return {line: lo + 1, column: offset - this.lines[lo] + 1}; };
    const a = position(start), b = position(end);
    return {file: this.file, start, end, ...a, endLine: b.line, endColumn: b.column};
  }
  error(message, at, code = 'F_UI_SYNTAX') { throw new Diagnostic(code, message, this.span(at)); }
  lexicalEnd(at) {
    const s = this.source;
    if (s.startsWith('//', at)) { const end = s.indexOf('\n', at + 2); return end < 0 ? s.length : end; }
    if (s.startsWith('/*', at)) {
      let i = at + 2, depth = 1;
      while (i < s.length && depth) { if (s.startsWith('/*', i)) { if (++depth > 128) this.error('Comment nesting budget exceeded', i); i += 2; } else if (s.startsWith('*/', i)) { depth--; i += 2; } else i++; }
      if (depth) this.error('Unterminated block comment', at); return i;
    }
    const raw = /^(?:b|c)?r(#{0,255})"/.exec(s.slice(at, at + 260));
    if (raw && (at === 0 || !/[\w]/.test(s[at - 1]))) {
      const close = '"' + raw[1], end = s.indexOf(close, at + raw[0].length);
      if (end < 0) this.error('Unterminated raw string', at); return end + close.length;
    }
    if (s[at] === '"' || s[at] === "'" && /^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\r\n])'/u.test(s.slice(at, at + 32))) {
      const quote = s[at]; let i = at + 1;
      while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i++] === quote) return i; }
      this.error('Unterminated literal', at);
    }
    return at;
  }
  trivia(at) {
    let i = at;
    for (;;) { while (/\s/.test(this.source[i] ?? '') && i < this.source.length) i++; const end = this.source.startsWith('//', i) || this.source.startsWith('/*', i) ? this.lexicalEnd(i) : i; if (end === i) return i; i = end; }
  }
  balanced(at) {
    const close = {'{': '}', '(': ')', '[': ']'}[this.source[at]];
    if (!close) this.error('Expected an opening delimiter', at);
    const stack = [close]; let i = at + 1;
    while (i < this.source.length) {
      const skipped = this.lexicalEnd(i); if (skipped !== i) { i = skipped; continue; }
      const c = this.source[i];
      if ('{(['.includes(c)) { if (stack.length > 128) this.error('Expression nesting budget exceeded', i); stack.push({'{': '}', '(': ')', '[': ']'}[c]); }
      else if ('})]'.includes(c)) { if (stack.pop() !== c) this.error('Mismatched expression delimiter', i); if (!stack.length) return i + 1; }
      i++;
    }
    this.error('Unclosed expression delimiter', at);
  }
  add(node) {
    if (this.nodes.length >= this.maxNodes) this.error('UI node budget exceeded', node.start);
    node.id = `${this.file}#v${node.start}`; node.span = this.span(node.start, node.end); this.nodes.push(node); return node;
  }
  parseElement(at, depth = 0) {
    if (depth > 128) this.error('Markup nesting budget exceeded', at);
    const s = this.source; let i = at + 1;
    const tagMatch = /^[A-Za-z_][\w:.-]*/.exec(s.slice(i));
    const tag = s[i] === '>' ? null : tagMatch?.[0];
    if (tag === undefined) this.error('Expected a tag name or fragment', i);
    if (tag) i += tag.length;
    const tagEnd = i, attributes = [];
    while (tag && i < s.length) {
      const gap = i; i = this.trivia(i);
      if (s.startsWith('/>', i) || s[i] === '>') break;
      if (i === gap) this.error('Separate attributes with whitespace', i);
      const name = /^[A-Za-z_][\w:.-]*/.exec(s.slice(i))?.[0];
      if (!name) this.error('Expected an attribute name', i);
      const start = i; i += name.length; i = this.trivia(i);
      let kind = 'boolean', value = true, valueStart = i, valueEnd = i;
      if (s[i] === '=') {
        i = this.trivia(i + 1); valueStart = i;
        if (s[i] === '{') { valueEnd = this.balanced(i); kind = 'expression'; value = s.slice(i + 1, valueEnd - 1); i = valueEnd; }
        else {
          valueEnd = this.lexicalEnd(i);
          if (valueEnd === i || !(s[i] === '"' || /^(?:r#*|b)"/.test(s.slice(i)))) this.error('Attribute values must be Rust strings or {Rust expressions}', i);
          kind = 'string'; value = Lexer.decode(s.slice(i, valueEnd)); i = valueEnd;
        }
      }
      if (attributes.some(a => a.name === name)) this.error(`Duplicate attribute ${name}`, start);
      attributes.push({name, kind, value, start, end: i, valueStart, valueEnd, span: this.span(start, i)});
    }
    const selfClosing = s.startsWith('/>', i);
    if (selfClosing) {
      if (!tag) this.error('A fragment cannot self-close', i);
      return this.add({kind: 'element', tag, tagEnd, attributes, children: [], start: at, openEnd: i + 2, closeStart: i, end: i + 2, selfClosing: true});
    }
    if (s[i] !== '>') this.error('Expected >', i);
    const openEnd = ++i, children = [];
    while (i < s.length && !s.startsWith('</', i)) {
      if (s[i] === '<') { const child = this.parseElement(i, depth + 1); children.push(child); i = child.end; }
      else if (s[i] === '{') { const end = this.balanced(i); children.push(this.add({kind: 'expression', start: i, end, value: s.slice(i + 1, end - 1)})); i = end; }
      else {
        const start = i; while (i < s.length && s[i] !== '<' && s[i] !== '{' && !s.startsWith('</', i)) i++;
        const raw = s.slice(start, i), value = raw.includes('\n') ? raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ') : raw;
        if (value) children.push(this.add({kind: 'text', start, end: i, value}));
      }
    }
    const closeStart = i; i += 2;
    const closing = /^[A-Za-z_][\w:.-]*/.exec(s.slice(i))?.[0] ?? null;
    if (closing) i += closing.length; i = this.trivia(i);
    if (closing !== tag || s[i] !== '>') this.error(`Expected closing ${tag ? `</${tag}>` : '</>'}`, closeStart);
    return this.add({kind: 'element', tag, tagEnd, attributes, children, start: at, openEnd, closeStart, end: i + 1, selfClosing: false});
  }
  scan(start = 0, end = this.source.length) {
    const found = []; let i = start;
    while (i < end) {
      const skip = this.lexicalEnd(i); if (skip !== i) { i = skip; continue; }
      if (this.source.startsWith('view', i) && (i === 0 || !/[\w:]/.test(this.source[i - 1])) && !/[\w]/.test(this.source[i + 4] ?? '')) {
        let bang = this.trivia(i + 4);
        if (this.source[bang] === '!') {
          const open = this.trivia(bang + 1), closer = {'{': '}', '(': ')', '[': ']'}[this.source[open]];
          if (!closer) this.error('view! requires a delimited body', open);
          const markup = this.trivia(open + 1);
          if (this.source[markup] !== '<') this.error('view! requires one element or fragment', markup);
          const node = this.parseElement(markup), close = this.trivia(node.end);
          if (this.source[close] !== closer) this.error(`Expected ${closer} after view! root`, close);
          const macro = {start: i, end: close + 1, node}; this.macros.push(macro); found.push(macro); i = close + 1; continue;
        }
      }
      i++;
    }
    return found;
  }
  expand() {
    const chunks = [], mappings = []; let length = 0;
    const emit = (text, start, end, identity = false) => { if (!text) return; chunks.push(text); mappings.push({start: length, end: length + text.length, sourceStart: start, sourceEnd: end, identity}); length += text.length; if (length > 2000000) this.error('Expanded UI source exceeds its budget', start); };
    const synthetic = (text, node) => emit(text, node.start, node.end);
    const code = (start, end) => {
      const macros = this.scan(start, end); let cursor = start;
      for (const macro of macros) { emit(this.source.slice(cursor, macro.start), cursor, macro.start, true); lower(macro.node); cursor = macro.end; }
      emit(this.source.slice(cursor, end), cursor, end, true);
    };
    const attrValue = attribute => attribute.kind === 'expression' ? code(attribute.valueStart + 1, attribute.valueEnd - 1) : emit(attribute.kind === 'boolean' ? 'true' : rustString(attribute.value), attribute.valueStart, attribute.valueEnd);
    const lower = node => {
      if (node.kind === 'text') { synthetic(`ui::text(${rustString(node.value)})`, node); return; }
      if (node.kind === 'expression') { synthetic('ui::child(', node); code(node.start + 1, node.end - 1); synthetic(')', node); return; }
      const component = !!node.tag && /^[A-Z_]|::/.test(node.tag);
      if (component && node.children.length) this.error('Pass component children explicitly through a Rust props struct', node.start, 'F_UI_COMPONENT_PROPS');
      if (component && node.attributes.some(a => !['props', 'key'].includes(a.name))) this.error('Components accept props={RustValue} and key; DOM attributes belong inside the component', node.start, 'F_UI_COMPONENT_PROPS');
      // Build a typed block with source-unique temporaries. Attributes evaluate once,
      // in source order, before child construction, matching ordinary Rust ordering.
      const temp = `${this.prefix}_${node.start}`;
      synthetic('{ ', node);
      node.attributes.forEach((a, index) => { synthetic(`let ${temp}_a${index} = `, node); attrValue(a); synthetic('; ', node); });
      synthetic(`let ${temp}_node = `, node);
      if (component) {
        const props = node.attributes.findIndex(a => a.name === 'props');
        synthetic(`ui::component(move || ${node.tag}(${props < 0 ? '' : `${temp}_a${props}`}))`, node);
      } else {
        synthetic(node.tag ? `ui::element(${rustString(node.tag)}, vec![` : 'ui::fragment(vec![', node);
        node.children.forEach((child, index) => { if (index) synthetic(', ', node); lower(child); }); synthetic('])', node);
      }
      synthetic('; ', node);
      node.attributes.forEach((a, index) => {
        if (component && a.name === 'props') return;
        let call;
        if (a.name === 'key') call = `ui::key(${temp}_node, ${temp}_a${index})`;
        else if (a.name === 'ref') call = `ui::node_ref(${temp}_node, ${temp}_a${index})`;
        else if (a.name === 'on:click' || a.name === 'onClick') call = `ui::on_click(${temp}_node, ${temp}_a${index})`;
        else if (a.name.startsWith('on_event:')) call = `ui::on_event(${temp}_node, ${rustString(a.name.slice(9))}, ${temp}_a${index})`;
        else if (a.name.startsWith('on:')) call = `ui::on(${temp}_node, ${rustString(a.name.slice(3))}, ${temp}_a${index})`;
        else call = `ui::attr(${temp}_node, ${rustString(a.name)}, ${temp}_a${index})`;
        synthetic(`let ${temp}_node = ${call}; `, node);
      });
      synthetic(`ui::source(${temp}_node, ${rustString(node.id)}) }`, node);
    };
    code(0, this.source.length);
    const source = chunks.join('');
    const mapOffset = (offset, end = false) => {
      if (!mappings.length) return 0;
      let lo = 0, hi = mappings.length;
      const at = end && offset > 0 ? offset - 1 : offset;
      while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (mappings[mid].start <= at) lo = mid; else hi = mid; }
      const m = mappings[lo]; return m.identity ? Math.min(m.sourceEnd, m.sourceStart + offset - m.start) : end ? m.sourceEnd : m.sourceStart;
    };
    return {source, nodes: this.nodes.sort((a, b) => a.start - b.start), macros: this.macros, mappings,
      mapSpan: span => this.span(mapOffset(span.start), mapOffset(span.end, true))};
  }
}
