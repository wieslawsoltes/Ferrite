import {RustDocument} from '../../language/RustDocument.js';
import {Dom} from '../views/Dom.js';

/** Lossless highlighting: use source slices, never normalized compiler token values. */
export class SyntaxHighlighter {
  static html(text, file, document = null) {
    if (!file?.endsWith('.rs')) return Dom.escape(text).replace(/(^|\n)(\[[^\n]*\])/g, '$1<span class="syntax-type">$2</span>');
    const parsed = document?.text === text && document?.file === file ? document : new RustDocument(text, file);
    return parsed.tokens.map(token => {
      const source = Dom.escape(text.slice(token.start, token.end));
      return ['whitespace','punctuation','text'].includes(token.kind) ? source : `<span class="syntax-${token.kind}">${source}</span>`;
    }).join('');
  }
}
