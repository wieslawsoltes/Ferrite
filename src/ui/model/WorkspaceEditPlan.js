import {SourceFile} from '../../project/SourceFile.js';

/** Validates UTF-16 edits as an atomic transaction; no silent clamping, overlap or unknown files. */
export class WorkspaceEditPlan {
  static offset(text,position){
    if(!position||!Number.isSafeInteger(position.line)||!Number.isSafeInteger(position.character)||position.line<0||position.character<0)throw Error('Invalid language-service position');
    const source=new SourceFile('',text);if(position.line>=source.lines.length)throw Error('Language edit line is outside the source');
    const start=source.lines[position.line];let end=position.line+1<source.lines.length?source.lines[position.line+1]-1:text.length;
    if(text[end-1]==='\r')end--;if(position.character>end-start)throw Error('Language edit column is outside the source');
    return start+position.character;
  }
  static span(file,text,range){const start=this.offset(text,range?.start),end=this.offset(text,range?.end);if(end<start)throw Error('Reversed language range');return new SourceFile(file,text).span(start,end);}
  static prepare(files,changes){
    if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('Invalid language workspace edit');
    const result=Object.create(null);let count=0;
    for(const [path,list] of Object.entries(changes)){
      if(!Object.hasOwn(files,path)||!Array.isArray(list))throw Error('Language edit refers to an unknown file');
      const text=files[path],edits=list.map(edit=>{if(typeof edit.newText!=='string')throw Error('Invalid edit text');const span=this.span(path,text,edit.range);return {...span,text:edit.newText};}).sort((a,b)=>a.start-b.start||a.end-b.end);
      let cursor=0,previous=null,output='';
      for(const edit of edits){if(edit.start<cursor||previous&&previous.start===edit.start)throw Error('Overlapping or ambiguous language edits');output+=text.slice(cursor,edit.start)+edit.text;cursor=edit.end;previous=edit;count++;}
      result[path]=output+text.slice(cursor);
    }
    return {files:result,count,paths:Object.keys(result)};
  }
}
