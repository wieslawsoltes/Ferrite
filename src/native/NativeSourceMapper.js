import {isAbsolute, resolve, relative, sep} from 'node:path';
import {SourceFile} from '../project/SourceFile.js';

/** Best-effort debug metadata mapping restricted to the submitted project files. */
export class NativeSourceMapper {
  constructor(root, files) { this.root=resolve(root); this.files=files; this.sources=new Map(); }
  file(filename,directory='') {
    const absolute=isAbsolute(filename)?resolve(filename):resolve(this.root,directory,filename);
    const path=relative(this.root,absolute).split(sep).join('/');
    if(path==='..'||path.startsWith('../')||isAbsolute(path)||!Object.hasOwn(this.files,path))return null;
    if(!this.sources.has(path))this.sources.set(path,new SourceFile(path,this.files[path]));
    return this.sources.get(path);
  }
  line(source,line) {
    if(!source||!Number.isSafeInteger(line)||line<1||line>source.lines.length)return null;
    const start=source.lines[line-1],end=line<source.lines.length?source.lines[line]-1:source.text.length;
    return end>start?source.span(start,end):null;
  }
  static quoted(text,name){const match=new RegExp(name+':\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(text);return match?match[1].replace(/\\([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))):null;}
  llvm(text) {
    const lines=text.split('\n'),metadata=new Map(),mapping=[];
    for(const line of lines){const match=/^!(\d+)\s*=\s*(?:distinct\s+)?!(\w+)\((.*)\)/.exec(line);if(match)metadata.set(match[1],{kind:match[2],text:match[3]});}
    const fileFor=(id,seen=new Set())=>{
      if(seen.has(id)||seen.size>64)return null;seen.add(id);const node=metadata.get(id);if(!node)return null;
      if(node.kind==='DIFile')return this.file(NativeSourceMapper.quoted(node.text,'filename')??'',NativeSourceMapper.quoted(node.text,'directory')??'');
      const next=/\bfile:\s*!(\d+)/.exec(node.text)??/\bscope:\s*!(\d+)/.exec(node.text);return next?fileFor(next[1],seen):null;
    };
    lines.forEach((line,index)=>{if(line.startsWith('!'))return;const reference=/!dbg\s+!(\d+)/.exec(line),node=reference&&metadata.get(reference[1]);if(!node)return;
      const source=fileFor(reference[1]),number=Number(/\bline:\s*(\d+)/.exec(node.text)?.[1]);const span=this.line(source,number);
      if(span)mapping.push({line:index+1,span,precision:'source-line',origin:'LLVM debug metadata'});
    });return mapping;
  }
  assembly(text) {
    const files=new Map(),mapping=[];let active=null;
    text.split('\n').forEach((line,index)=>{
      const declaration=/^\s*\.file\s+(\d+)\s+(.*)$/.exec(line);
      if(declaration){const strings=[...declaration[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m=>{try{return JSON.parse('"'+m[1]+'"');}catch{return m[1];}});if(strings.length)files.set(Number(declaration[1]),this.file(strings.at(-1),strings.length>1?strings[0]:''));active=null;return;}
      const location=/^\s*\.loc\s+(\d+)\s+(\d+)/.exec(line);
      if(location){active=this.line(files.get(Number(location[1])),Number(location[2]));return;}
      if(active&&/^\s+[A-Za-z][A-Za-z0-9_.]*\s/.test(line))mapping.push({line:index+1,span:active,precision:'source-line',origin:'Assembler .loc metadata'});
    });return mapping;
  }
  map(kind,text){return kind==='llvm-ir'?this.llvm(text):kind==='asm'?this.assembly(text):[];}
}
