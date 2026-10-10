/** Static JS literals only. Template substitutions are never evaluated. */
export function literals(source) {
  const results = [];
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); if (end < 0) throw Error('Unterminated comment'); i = end + 1; continue; }
    const quote = source[i];
    if (!['"', "'", '`'].includes(quote)) continue;
    const start = i++; let value = '', dynamic = false;
    for (; i < source.length && source[i] !== quote; i++) {
      let c = source[i];
      if (quote === '`' && source.startsWith('${', i)) dynamic = true;
      if (c !== '\\') { value += c; continue; }
      c = source[++i];
      if (c === '\n') continue;
      if (c === '\r') { if (source[i + 1] === '\n') i++; continue; }
      const simple = {n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', v:'\v', 0:'\0'};
      if (Object.hasOwn(simple, c)) value += simple[c];
      else if (c === 'x' || c === 'u') {
        let digits, end;
        if (c === 'u' && source[i + 1] === '{') { end = source.indexOf('}', i + 2); digits = source.slice(i + 2, end); }
        else { end = i + (c === 'x' ? 2 : 4); digits = source.slice(i + 1, end + 1); }
        if (!/^[\da-f]+$/i.test(digits)) throw Error('Invalid literal escape');
        value += String.fromCodePoint(parseInt(digits,16)); i = end;
      } else value += c;
    }
    if (i >= source.length) throw Error('Unterminated sample literal');
    if (!dynamic) results.push({start, end:i + 1, value});
  }
  return results;
}
export function template(value) {
  return '`' + value.replaceAll('\\','\\\\').replaceAll('`','\\`').replaceAll('${','\\${') + '`';
}
export const isRust = value => /^(?:(?:\/\/[^\n]*\n)\s*)*(?:#\[|#!\[|fn |pub |mod |use |struct |enum |impl |extern |async |macro_rules!)/.test(value.trim());
