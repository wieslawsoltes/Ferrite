import {SourceFile} from '../project/SourceFile.js';

export const RUST_KEYWORDS = new Set('as async await break const continue crate dyn else enum extern false fn for gen if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while union abstract become box do final macro override priv try typeof unsized virtual yield'.split(' '));
export const SEMANTIC_TOKEN_TYPES = Object.freeze(['namespace','type','class','enum','interface','struct','typeParameter','parameter','variable','property','enumMember','event','function','method','macro','keyword','comment','string','number','operator','decorator']);
export const SEMANTIC_TOKEN_MODIFIERS = Object.freeze(['declaration','readonly']);
const identifier = /(?:r#)?[\p{XID_Start}_][\p{XID_Continue}_]*/uy;
const markupName = /[A-Za-z_][\w:.-]*/y;
const number = /(?:0[xob][\da-fA-F_]*|\d[\d_]*(?:\.(?![.\p{XID_Start}_])[\d_]*)?(?:[eE][+-]?[\d_]+)?)(?:[ui](?:8|16|32|64|128|size)|f(?:32|64))?/uy;
const rawString = /(?:br|cr|r)(#{0,255})"/y;
const operators = /(?:<<=|>>=|\.\.=|::|->|=>|==|!=|<=|>=|&&|\|\||<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\.\.)/y;
const closers = {'{':'}','(':')','[':']'};
const trivia = kind => kind === 'whitespace' || kind === 'comment';
const matchAt = (pattern, text, offset) => { pattern.lastIndex = offset; return pattern.exec(text); };
const nameOf = value => value.replace(/^r#/, '').normalize('NFC');

/** Lossless, bounded editor scanner. Invalid/incomplete Rust is NOT compiler input.
 * Rust and view! markup have separate lexical states; prose never reaches the Rust
 * lexer. Tokens always refer to the original UTF-16 text, including raw identifiers.
 */
export class RustDocument {
  constructor(text, file = 'src/main.rs', {maxTokens = 100000, maxDepth = 128} = {}) {
    if (typeof text !== 'string') throw new TypeError('Expected source text');
    this.text = text; this.file = file; this.source = new SourceFile(file, text);
    this.tokens = []; this.elements = []; this.macros = []; this.offset = 0;
    this.maxTokens = maxTokens; this.maxDepth = maxDepth; this.truncated = false;
    this.rust(null, 0); this.classify();
  }
  emit(kind, start, end, context = 'rust', extra = {}) {
    if (end <= start) return null;
    this.offset = end;
    const token = {kind, start, end, value: this.text.slice(start, end), context, ...extra};
    this.tokens.push(token); return token;
  }
  budget(depth) {
    if (this.tokens.length < this.maxTokens && depth <= this.maxDepth) return true;
    this.truncated = true; this.emit('text', this.offset, this.text.length); return false;
  }
  /** A single tolerant Rust lexeme. Always advances, even on an illegal scalar. */
  lex(context = 'rust') {
    const s = this.text, start = this.offset, c = s[start]; let end = start + 1;
    if (start >= s.length) return null;
    if (/\s/u.test(c) || c === '\ufeff') {
      while (end < s.length && /\s/u.test(s[end])) end++;
      return this.emit('whitespace', start, end, context);
    }
    if (s.startsWith('//', start) || start === 0 && s.startsWith('#!', start) && s[2] !== '[') {
      end = s.indexOf('\n', start); return this.emit('comment', start, end < 0 ? s.length : end, context);
    }
    if (s.startsWith('/*', start)) {
      end = start + 2; let depth = 1;
      while (end < s.length && depth) {
        if (s.startsWith('/*', end)) { depth++; end += 2; }
        else if (s.startsWith('*/', end)) { depth--; end += 2; } else end++;
      }
      return this.emit('comment', start, end, context, {incomplete: depth !== 0});
    }
    const raw = matchAt(rawString, s, start);
    if (raw) {
      const close = '"' + raw[1], at = s.indexOf(close, start + raw[0].length);
      return this.emit('string', start, at < 0 ? s.length : at + close.length, context, {incomplete: at < 0});
    }
    const prefixed = (c === 'b' || c === 'c') && s[start + 1] === '"' || c === 'b' && s[start + 1] === "'";
    const quoteAt = start + (prefixed ? 1 : 0), quote = s[quoteAt];
    if (quote === '"' || quote === "'") {
      if (!prefixed && quote === "'") {
        const lifetime = matchAt(identifier, s, start + 1);
        if (lifetime && s[start + 1 + lifetime[0].length] !== "'")
          return this.emit('lifetime', start, start + 1 + lifetime[0].length, context);
      }
      end = quoteAt + 1; let closed = false;
      while (end < s.length) {
        if (s[end] === '\\') { end = Math.min(s.length, end + 2); continue; }
        if (s[end] === quote) { end++; closed = true; break; }
        if (quote === "'" && (s[end] === '\n' || s[end] === '\r')) break;
        end++;
      }
      return this.emit(quote === "'" ? 'char' : 'string', start, end, context, {incomplete: !closed});
    }
    const ident = matchAt(identifier, s, start);
    if (ident) {
      const value = ident[0], name = nameOf(value), raw = value.startsWith('r#');
      return this.emit(!raw && RUST_KEYWORDS.has(name) ? 'keyword' : 'identifier', start, start + value.length, context, {name, identifier: true, raw});
    }
    if (c >= '0' && c <= '9') {
      const literal = matchAt(number, s, start);
      if (literal) return this.emit('number', start, start + literal[0].length, context);
    }
    const operator = matchAt(operators, s, start);
    if (operator) return this.emit('operator', start, start + operator[0].length, context);
    const kind = '{}()[],:;.!<>+=*/%&|-?#^@$'.includes(c) ? 'punctuation' : 'invalid';
    return this.emit(kind, start, start + (s.codePointAt(start) > 0xffff ? 2 : 1), context);
  }
  triviaEnd(at) {
    const s = this.text;
    for (;;) {
      while (at < s.length && /\s/u.test(s[at])) at++;
      if (s.startsWith('//', at)) { const end = s.indexOf('\n', at); at = end < 0 ? s.length : end; continue; }
      if (!s.startsWith('/*', at)) return at;
      let depth = 1; at += 2;
      while (at < s.length && depth) {
        if (s.startsWith('/*', at)) { depth++; at += 2; }
        else if (s.startsWith('*/', at)) { depth--; at += 2; } else at++;
      }
    }
  }
  rust(close, depth) {
    const s = this.text, stack = [];
    while (this.offset < s.length && this.budget(depth + stack.length)) {
      const token = this.lex();
      if (token.identifier && !token.raw && token.name === 'view') {
        const bang = this.triviaEnd(this.offset), open = this.triviaEnd(bang + 1);
        if (s[bang] === '!' && Object.hasOwn(closers, s[open])) {
          token.kind = 'macro';
          while (this.offset <= open) this.lex();
          const macro = {start: token.start, open, end: s.length}; this.macros.push(macro);
          this.view(closers[s[open]], depth + 1); macro.end = this.offset; continue;
        }
      }
      if (token.kind !== 'punctuation') continue;
      if (Object.hasOwn(closers, token.value)) stack.push(closers[token.value]);
      else if (token.value === stack.at(-1)) stack.pop();
      else if (!stack.length && token.value === close) return;
    }
  }
  view(close, depth) {
    const s = this.text;
    while (this.offset < s.length && this.budget(depth)) {
      if (s[this.offset] === close) { this.lex(); return; }
      if (s[this.offset] === '<') this.element(null, close, depth + 1);
      else this.lex(); // trivia or an unfinished/invalid root; never abandon the prefix
    }
  }
  element(parent, macroClose, depth) {
    if (!this.budget(depth)) return;
    const s = this.text, start = this.offset;
    this.emit('punctuation', start, start + 1, 'markup');
    let closing = false;
    if (s[this.offset] === '/') { closing = true; this.emit('punctuation', this.offset, this.offset + 1, 'markup'); }
    const tagStart = this.offset, name = matchAt(markupName, s, this.offset)?.[0] ?? '';
    const component = /^[A-Z_]|::/.test(name);
    if (name) this.emit(component ? 'component' : 'tag', tagStart, tagStart + name.length, 'markup', {name, closing});
    const element = {start, tag: name, tagStart, tagEnd: this.offset, attributes: [], parent, end: s.length, openEnd: s.length, closing, complete: false};
    this.elements.push(element);
    while (this.offset < s.length && this.budget(depth)) {
      let at = this.offset;
      if (s.startsWith('/>', at)) {
        this.emit('punctuation', at, at + 2, 'markup'); element.end = element.openEnd = this.offset; element.complete = true; element.selfClosing = true; return;
      }
      if (s[at] === '>') { this.emit('punctuation', at, at + 1, 'markup'); element.openEnd = this.offset; break; }
      if (s[at] === '<' || s[at] === macroClose) { element.end = at; return; }
      if (/\s/u.test(s[at]) || s.startsWith('//', at) || s.startsWith('/*', at)) { this.lex('markup'); continue; }
      const attrName = matchAt(markupName, s, at)?.[0];
      if (!attrName) { this.lex('markup'); continue; }
      const attribute = {name: attrName, start: at, nameEnd: at + attrName.length, end: at + attrName.length}; element.attributes.push(attribute);
      this.emit(/^(on:|on_event:|on[A-Z])/.test(attrName) ? 'event' : 'attribute', at, attribute.end, 'markup', {name: attrName});
      const gapEnd = this.triviaEnd(this.offset); while (this.offset < gapEnd) this.lex('markup');
      if (s[this.offset] !== '=') continue;
      this.emit('operator', this.offset, this.offset + 1, 'markup');
      const valueAt = this.triviaEnd(this.offset); while (this.offset < valueAt) this.lex('markup');
      attribute.valueStart = this.offset;
      if (s[this.offset] === '{') { this.lex(); this.rust('}', depth + 1); }
      else if (this.offset < s.length && !['>','<',macroClose].includes(s[this.offset]) && !s.startsWith('/>', this.offset)) this.lex('markup');
      attribute.end = this.offset;
    }
    if (closing) { element.end = this.offset; element.complete = s[this.offset - 1] === '>'; return; }
    while (this.offset < s.length && this.budget(depth)) {
      const at = this.offset;
      if (s.startsWith('</', at)) {
        const before = this.elements.length; this.element(element, macroClose, depth + 1);
        const closingElement = this.elements[before];
        element.closeStart = at; element.closeNameStart = closingElement?.tagStart; element.closeNameEnd = closingElement?.tagEnd;
        element.end = this.offset; element.complete = !!closingElement?.complete && closingElement.tag === name; return;
      }
      if (s[at] === '<') { this.element(element, macroClose, depth + 1); continue; }
      if (s[at] === '{') { this.lex(); this.rust('}', depth + 1); continue; }
      // Recover at a standalone macro delimiter after an unfinished element.
      if (s[at] === macroClose && /(?:^|\n)[ \t]*$/.test(s.slice(Math.max(start, s.lastIndexOf('\n', at - 1)), at))) { element.end = at; return; }
      let end = at + 1;
      while (end < s.length && !'<{'.includes(s[end]) && s[end] !== macroClose) end++;
      this.emit('text', at, end, 'markup');
    }
  }
  classify() {
    const significant = this.tokens.filter(token => !trivia(token.kind));
    for (let i = 0; i < significant.length; i++) {
      const token = significant[i]; if (token.kind !== 'identifier' || token.context !== 'rust') continue;
      const previous = significant[i - 1]?.value, next = significant[i + 1]?.value;
      if (previous === 'fn') token.kind = 'function';
      else if (['struct','enum','trait','type','union'].includes(previous) || /^(?:[A-Z]|[iu](?:8|16|32|64|128|size)$|f(?:32|64)$|bool$|str$)/.test(token.name)) token.kind = 'type';
      else if (next === '!') token.kind = 'macro';
      else if (next === '::' || previous === 'mod') token.kind = 'namespace';
      else if (next === '(') token.kind = 'function';
    }
  }
  tokenAt(offset, left = false) {
    let lo = 0, hi = this.tokens.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.tokens[mid].end <= offset) lo = mid + 1; else hi = mid; }
    if (left && lo > 0 && this.tokens[lo - 1].end === offset) return this.tokens[lo - 1];
    return this.tokens[lo] ?? null;
  }
  span(token) { return this.source.span(token.start, token.end); }
  /** LSP relative encoding, split at LF/CRLF boundaries without overlapping tokens. */
  semanticTokens({range, occurrences = []} = {}) {
    const semantic = new Map(occurrences.filter(item => item.span.file === this.file).map(item => [item.span.start, item]));
    const kinds = {identifier:'variable', function:'function', type:'type', namespace:'namespace', keyword:'keyword', macro:'macro', tag:'type', component:'class', attribute:'property', event:'event', string:'string', char:'string', comment:'comment', number:'number', operator:'operator', lifetime:'typeParameter'};
    const data = []; let previousLine = 0, previousChar = 0;
    for (const token of this.tokens) {
      let type = kinds[token.kind]; if (!type) continue;
      const binding = semantic.get(token.start), resolved = binding && binding.span.end === token.end;
      if (resolved && token.identifier) type = binding.key.startsWith('binding:') ? 'variable' : binding.type === 'fn' ? 'function' : type;
      const modifiers = resolved && binding.declaration ? 1 : 0;
      let start = token.start;
      while (start < token.end) {
        const position = this.source.position(start), line = position.line - 1, character = position.column - 1;
        const nextLine = this.source.lines[line + 1] ?? this.text.length + 1;
        let end = Math.min(token.end, nextLine - 1);
        if (this.text[end - 1] === '\r') end--;
        const overlaps = !range || line >= range.start.line && line <= range.end.line && (line !== range.start.line || end - start + character > range.start.character) && (line !== range.end.line || character < range.end.character);
        if (end > start && overlaps) {
          data.push(line - previousLine, line === previousLine ? character - previousChar : character, end - start, SEMANTIC_TOKEN_TYPES.indexOf(type), modifiers);
          previousLine = line; previousChar = character;
        }
        start = Math.min(token.end, nextLine);
      }
    }
    return {data};
  }
}
