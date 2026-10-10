import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ViewSyntax} from '../../src/ui-framework/ViewSyntax.js';
import {Lexer} from '../../src/compiler/Lexer.js';
import {Parser} from '../../src/compiler/Parser.js';

const config = fileURLToPath(new URL('../sample-rustfmt.toml', import.meta.url));
const padding = level => ' '.repeat(level);

/** Format ordinary Rust with pinned rustfmt, and view! with the compiler's actual parser.
 * The host formatter never sees markup. Literal text and mixed-content boundaries
 * are retained exactly: cosmetic line breaks must not change a rendered label.
 */
export class RustFormatter {
  constructor({executable = process.env.RUSTFMT} = {}) {
    this.executable = executable || 'rustup';
    this.arguments = executable ? [] : ['run', '1.90.0', 'rustfmt'];
    this.cache = new Map();
  }

  rustfmt(source) {
    const result = spawnSync(this.executable, [...this.arguments, '--emit', 'stdout', '--config-path', config], {
      input: source, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024
    });
    if (result.error || result.status !== 0) {
      throw Error(`rustfmt failed: ${result.error?.message ?? result.stderr}\n${source.slice(0,160)}`);
    }
    return result.stdout;
  }

  format(source) {
    if (typeof source !== 'string') throw TypeError('Expected Rust source');
    const scanner = new ViewSyntax(source);
    const macros = scanner.scan();
    let prefix = '__view';
    while (source.includes(prefix)) prefix += '_';
    let masked = source;
    for (let i = macros.length - 1; i >= 0; i--) {
      masked = masked.slice(0, macros[i].start) + `${prefix}${i}` + masked.slice(macros[i].end);
    }
    let formatted = separateItems(this.rustfmt(masked));
    // Restore from right to left: already emitted markup cannot contain the mask.
    const matches = [...formatted.matchAll(new RegExp(`\\b${prefix}(\\d+)\\b`, 'g'))];
    if (matches.length !== macros.length) throw Error('rustfmt changed a view placeholder');
    for (const match of matches.reverse()) {
      const at = match.index, line = formatted.slice(formatted.lastIndexOf('\n', at) + 1, at);
      const indent = /^ */.exec(line)[0].length;
      const node = macros[Number(match[1])].node;
      const markup = `view! {\n${padding(indent + 4)}${this.element(node, source, indent + 4)}\n${padding(indent)}}`;
      formatted = formatted.slice(0, at) + markup + formatted.slice(at + match[0].length);
    }
    return formatted;
  }

  expression(source) {
    source = source.trim();
    if (this.cache.has(source)) return this.cache.get(source);
    const formatted = this.format(`fn __sample_expression() { let __value = ${source}; }\n`);
    const marker = 'let __value =';
    const start = formatted.indexOf(marker) + marker.length;
    const tail = formatted.lastIndexOf(';\n}');
    if (start < marker.length || tail < start) throw Error('Unexpected expression wrapper');
    let value = formatted.slice(start, tail);
    const indent = value.startsWith('\n') ? /^\s*\n( *)/.exec(value)?.[1].length ?? 4 : 4;
    value = value.trim().split('\n').map((line, index) => index ? line.replace(new RegExp(`^ {0,${indent}}`), '') : line).join('\n');
    this.cache.set(source, value);
    return value;
  }

  expressionNode(value, indent) {
    const formatted = this.expression(value);
    if (!formatted.includes('\n') && indent + formatted.length + 2 <= 100) return `{${formatted}}`;
    return `{\n${padding(indent + 4)}${formatted.replaceAll('\n', '\n' + padding(indent + 4))}\n${padding(indent)}}`;
  }

  element(node, source, indent) {
    if (node.kind === 'text') return wrapText(node.value, indent);
    if (node.kind === 'expression') return this.expressionNode(node.value, indent);
    const attributes = node.attributes.map(attribute => {
      if (attribute.kind === 'boolean') return attribute.name;
      const value = attribute.kind === 'expression'
        ? this.expressionNode(attribute.value, indent + 4)
        : source.slice(attribute.valueStart, attribute.valueEnd);
      return `${attribute.name}=${value}`;
    });
    const tag = node.tag ?? '';
    const suffix = node.selfClosing ? ' />' : '>';
    const single = `<${tag}${attributes.length ? ' ' + attributes.join(' ') : ''}${suffix}`;
    const multiline = attributes.length > 1 || attributes.some(a => a.includes('\n')) || indent + single.length > 100;
    const open = multiline
      ? `<${tag}\n${padding(indent + 4)}${attributes.join('\n' + padding(indent + 4))}\n${padding(indent)}${suffix.trimStart()}`
      : single;
    if (node.selfClosing) return open;
    const close = `</${tag}>`;
    if (!node.children.length) return open + close;
    const mixed = node.children.some(child => child.kind === 'text');
    const inlineText = node.children.some(child => child.kind === 'text' && child.value !== child.value.trim());
    // Significant spaces around expressions must stay on their original text
    // boundaries (e.g. "Hello, {name}!" and "Duration: {n} seconds"). All other
    // structural children can occupy separate, indented lines.
    if (inlineText) return open + node.children.map(child => this.element(child, source, indent)).join('') + close;
    if (mixed && node.children.length === 1 && !multiline &&
        indent + open.length + node.children[0].value.length + close.length <= 100) {
      return open + node.children[0].value + close;
    }
    const children = node.children.map(child => this.element(child, source, indent + 4));
    if (children.length === 1 && node.children[0].kind === 'expression' && !children[0].includes('\n') &&
        !multiline && indent + open.length + children[0].length + close.length <= 100) return open + children[0] + close;
    return open + '\n' + children.map(child => padding(indent + 4) + child).join('\n') + '\n' + padding(indent) + close;
  }
}

/** Formatting-independent view structure and expressions, with EXACT text values. */
export function viewSignature(source) {
  const syntax = new ViewSyntax(source);
  const node = value => value.kind === 'text' ? {kind:'text', value:value.value} : value.kind === 'expression'
    ? {kind:'expression', value:rustSignature(`fn __value(){let value = ${value.value};}`), views:viewSignature(value.value)}
    : {kind:'element', tag:value.tag, selfClosing:value.selfClosing,
      attributes:value.attributes.map(a => [a.name,a.kind,a.kind === 'expression' ? [rustSignature(`fn __value(){let value = ${a.value};}`),viewSignature(a.value)] : a.value]),
      children:value.children.map(node)};
  return syntax.scan().map(macro => node(macro.node));
}

/** Used for sample-only equivalence checks, not as a general Rust equivalence proof.
 * rustfmt inserts/removes optional trailing list separators; all other nontrivia
 * tokens, including literal spellings and operators, must stay the same.
 */
export function rustTokens(source) {
  const scanner = new ViewSyntax(source);
  const macros = scanner.scan();
  for (const macro of macros.reverse()) source = source.slice(0,macro.start) + '__view' + source.slice(macro.end);
  return Lexer.tokenize(source).filter((token, index, tokens) =>
    token.value !== 'EOF' && !(token.value === ',' && ['}',')',']'].includes(tokens[index + 1]?.value))
  ).map(token => token.value);
}

/** Parse the sample subset to compare behavior-bearing syntax without locations.
 * Native-only constructs fall back to a conservative token comparison. */
export function rustSignature(source) {
  const syntax = new ViewSyntax(source);
  for (const macro of syntax.scan().reverse()) {
    source = source.slice(0, macro.start) + '__view' + source.slice(macro.end);
  }
  const clean = value => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clean);
    // rustfmt can wrap a conditional match-arm expression in a pure block.
    if (['arm', 'closure'].includes(value.kind) && value.body?.kind === 'block' && !value.body.body.length && value.body.tail) {
      value = {...value, body: value.body.tail};
    }
    if (value.tokens?.some(token => token && typeof token === 'object')) value = {...value, tokens: value.tokens.map(token => token.value)};
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['id', 'loc', 'span', 'start', 'end', 'offset', 'line', 'column', 'file', 'endLine', 'endColumn'].includes(key))
      .map(([key, child]) => [key, clean(child)]));
  };
  try { return {ast: clean(Parser.parse(Lexer.tokenize(source)))}; }
  catch { return {tokens: rustTokens(source)}; }
}

function separateItems(source) {
  const tokens = Lexer.tokenize(source, {trivia:true});
  const insertions = []; let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (['{','(','['].includes(token.value)) depth++;
    else if (['}',')',']'].includes(token.value)) depth--;
    if (depth || !['}', ';'].includes(token.value)) continue;
    const gap = tokens[i + 1], next = tokens[i + 2];
    if (gap?.kind !== 'whitespace' || !gap.value.includes('\n') || gap.value.includes('\n\n')) continue;
    if (!next || next.value === 'EOF' || next.value === ';') continue;
    if (token.value === ';' && !['fn','struct','enum','impl','#','pub','async'].includes(next.value)) continue;
    insertions.push(token.span.end);
  }
  for (const offset of insertions.reverse()) source = source.slice(0,offset) + '\n' + source.slice(offset);
  return source;
}

function wrapText(value, indent) {
  if (value !== value.trim() || value.split(/\s+/).join(' ') !== value) return value;
  const lines = []; let line = '';
  for (const word of value.split(' ')) {
    if (line && indent + line.length + word.length + 1 > 100) { lines.push(line); line = ''; }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines.join('\n' + padding(indent));
}
