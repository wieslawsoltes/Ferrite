/** CSS layout-only formatter for the checked-in sample styles, not a minifier.
 * Strings, escapes, comments, selector whitespace and parenthesized values remain
 * intact. Only rule/declaration boundaries and property colon spacing are changed.
 */
export function formatCss(source) {
  let buffer = '', depth = 0, parentheses = 0, bracket = 0, quote = null;
  const lines = [];
  const emit = (suffix = '', property = false) => {
    let text = buffer.trim();
    buffer = '';
    if (property) text = text.replace(/^([\w-]+)\s*:\s*/, '$1: ');
    if (text || suffix) lines.push(' '.repeat(depth * 4) + text + suffix);
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { buffer += c + (source[++i] ?? ''); continue; }
    if (quote) { buffer += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; buffer += c; continue; }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw Error('Unterminated CSS comment');
      buffer += source.slice(i, end + 2); i = end + 1; continue;
    }
    if (c === '(') parentheses++;
    else if (c === ')') parentheses--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    if (!parentheses && !bracket) {
      if (c === '{') { buffer = selector(buffer.trim(), depth); emit(' {'); depth++; continue; }
      if (c === ';') { emit(';', true); continue; }
      if (c === '}') {
        if (buffer.trim()) emit(';', true);
        buffer = ''; if (--depth < 0) throw Error('Unbalanced CSS rule');
        lines.push(' '.repeat(depth * 4) + '}');
        if (depth === 0) lines.push('');
        continue;
      }
    }
    buffer += c;
  }
  if (quote || depth || parentheses || bracket) throw Error('Unbalanced CSS sample');
  if (buffer.trim()) emit();
  return lines.join('\n').trimEnd() + '\n';
}

function selector(text, indent) {
  let output = '', quote = null, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { output += c + (text[++i] ?? ''); continue; }
    if (quote) { output += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; output += c; continue; }
    if ('(['.includes(c)) depth++; else if (')]'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      output = output.trimEnd() + ',\n' + ' '.repeat(indent * 4);
      while (/\s/.test(text[i + 1] ?? '') && i + 1 < text.length) i++;
    } else output += c;
  }
  return output;
}
