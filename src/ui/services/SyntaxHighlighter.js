import {Lexer} from '../../compiler/Lexer.js';
import {Dom} from '../views/Dom.js';
/** Highlighting is tolerant of unfinished edits and never injects source as markup. */
export class SyntaxHighlighter {
  static html(text, file) {
    if (text.length > 150_000) return Dom.escape(text);
    if (!file?.endsWith('.rs')) return Dom.escape(text).replace(/(^|\n)(\[[^\n]*\])/g,'$1<span class="syntax-type">$2</span>');
    try {
      const tokens = Lexer.tokenize(text,{file,trivia:true}); let previous = '';
      return tokens.filter(t=>t.kind!=='eof').map(token=>{
        let kind = token.kind;
        if (kind==='identifier') {
          if (previous==='fn') kind='function'; else if (/^[A-Z]|^(?:[iu]\d+|[iu]size|f32|f64|bool|str)$/.test(token.value)) kind='type';
        }
        if (!['whitespace','comment'].includes(token.kind)) previous=token.value;
        return ['whitespace','punctuation'].includes(kind) ? Dom.escape(token.value) : `<span class="syntax-${kind}">${Dom.escape(token.value)}</span>`;
      }).join('');
    } catch { return Dom.escape(text); }
  }
}
