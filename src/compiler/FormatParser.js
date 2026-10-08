import {Diagnostic} from './Diagnostic.js';

/** Shared formatting contract: positional {}, debug {:?}, and escaped braces. */
export class FormatParser {
  static parse(text, node) {
    const parts = []; let literal = '', index = 0;
    for (let i = 0; i < text.length;) {
      if (text.startsWith('{{', i) || text.startsWith('}}', i)) { literal += text[i]; i += 2; continue; }
      if (text[i] === '{') {
        if (literal) parts.push({text: literal}); literal = '';
        const end = text.indexOf('}', i + 1);
        if (end < 0) throw new Diagnostic('E_FMT', 'Unclosed format placeholder', node?.span);
        const spec = text.slice(i + 1, end);
        if (!['', ':?'].includes(spec)) throw new Diagnostic('F_FMT', `Format specifier '{${spec}}' is not implemented`, node?.span);
        parts.push({argument: index++, debug: spec === ':?'}); i = end + 1;
      } else if (text[i] === '}') throw new Diagnostic('E_FMT', "Unescaped '}' in format string", node?.span);
      else literal += text[i++];
    }
    if (literal) parts.push({text: literal});
    return {parts, argumentCount: index};
  }
}
