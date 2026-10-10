import {CompletionEdits} from '../../language/CompletionEdits.js';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkspaceEditPlan as Edits} from '../../ui/model/WorkspaceEditPlan.js';

/** Does not read server-provided paths: locations and edits are limited to the supplied project. */
export class LanguageResultMapper {
  constructor(root,files){this.root=resolve(root);this.files=files;}
  path(uri){try{if(new URL(uri).protocol!=='file:')return null;const path=relative(this.root,resolve(fileURLToPath(uri))).split(sep).join('/');return path==='..'||path.startsWith('../')||isAbsolute(path)||!Object.hasOwn(this.files,path)?null:path;}catch{return null;}}
  span(uri,range){const path=this.path(uri);return path?Edits.span(path,this.files[path],range):null;}
  locations(raw){return (Array.isArray(raw)?raw:raw?[raw]:[]).slice(0,3000).flatMap(item=>{const span=this.span(item.targetUri??item.uri,item.targetSelectionRange??item.range);return span?[{span}]:[];});}
  edits(raw){
    const changes=Object.create(null);const add=(uri,edits)=>{const path=this.path(uri);if(!path)throw Error('Refactoring requested edits outside the supplied project');(changes[path]??=[]).push(...edits);};
    for(const [uri,edits] of Object.entries(raw?.changes??{}))add(uri,edits);
    for(const change of raw?.documentChanges??[]){if(change.kind||!change.textDocument||!Array.isArray(change.edits))throw Error('File creation, deletion and rename operations require explicit project tooling');add(change.textDocument.uri,change.edits);}
    Edits.prepare(this.files,changes);return changes;
  }
  static text(contents){if(typeof contents==='string')return contents;if(Array.isArray(contents))return contents.map(c=>this.text(c)).join('\n\n');return contents?.value??'';}
  map(method,raw,file,position){
    if(['textDocument/definition','textDocument/references'].includes(method))return {locations:this.locations(raw)};
    if(method==='textDocument/rename')return {changes:this.edits(raw)};
    if(method==='textDocument/hover')return {text:LanguageResultMapper.text(raw?.contents),span:raw?.range?Edits.span(file,this.files[file],raw.range):null};
    if(method==='textDocument/signatureHelp'){const signature=raw?.signatures?.[raw.activeSignature??0],parameter=signature?.parameters?.[signature.activeParameter??raw.activeParameter??0];return {text:signature?signature.label+(parameter?'\n\nParameter: '+(Array.isArray(parameter.label)?signature.label.slice(...parameter.label):parameter.label):''):''};}
    if(method==='textDocument/completion')return {items:CompletionEdits.items(this.files,file,position,raw)};
    if(method==='textDocument/documentSymbol'){
      const symbols=[];const walk=(items,depth=0)=>{if(depth>32)return;for(const item of items??[]){if(symbols.length>=3000)return;const span=item.location?this.span(item.location.uri,item.location.range):Edits.span(file,this.files[file],item.selectionRange??item.range);if(span)symbols.push({name:item.name,kind:item.kind,detail:item.detail??'',span});walk(item.children,depth+1);}};walk(raw);return {symbols};
    }
    return {text:''};
  }
}
