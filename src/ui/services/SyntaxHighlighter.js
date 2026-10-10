import {RustDocument} from '../../language/RustDocument.js';
import {Dom} from '../views/Dom.js';

/** Lossless highlighting: use source slices, never normalized compiler token values. */
export class SyntaxHighlighter {
  static html(text, file, document = null, diagnostics = []) {
    if (!file?.endsWith('.rs')) return Dom.escape(text).replace(/(^|\n)(\[[^\n]*\])/g, '$1<span class="syntax-type">$2</span>');
    const parsed = document?.text === text && document?.file === file ? document : new RustDocument(text, file);
    const ranges = diagnostics.map(d => ({...d.span, message:d.message, severity:d.severity})).sort((a,b) => a.start-b.start);
    if(!ranges.length)return parsed.tokens.map(token=>{const source=Dom.escape(text.slice(token.start,token.end));return ['whitespace','punctuation','text'].includes(token.kind)?source:`<span class="syntax-${token.kind}">${source}</span>`;}).join('');
    let cursor = 0;
    return parsed.tokens.map(token => {
      while(cursor<ranges.length&&ranges[cursor].end<=token.start)cursor++;
      const pieces=[],boundaries=new Set([token.start,token.end]),active=[];
      for(let i=cursor;i<ranges.length&&ranges[i].start<token.end;i++)if(ranges[i].end>token.start){active.push(ranges[i]);boundaries.add(Math.max(token.start,ranges[i].start));boundaries.add(Math.min(token.end,ranges[i].end));}
      const offsets=[...boundaries].sort((a,b)=>a-b);
      for(let i=1;i<offsets.length;i++){
        const start=offsets[i-1],end=offsets[i],issue=active.find(d=>d.start<=start&&d.end>=end);
        let source=Dom.escape(text.slice(start,end));
        if(issue)source=`<span class="editor-diagnostic ${issue.severity===2?'warning':'error'}" title="${Dom.escape(issue.message)}">${source}</span>`;
        pieces.push(source);
      }
      const source=pieces.join('');
      return ['whitespace','punctuation','text'].includes(token.kind) ? source : `<span class="syntax-${token.kind}">${source}</span>`;
    }).join('');
  }
}
