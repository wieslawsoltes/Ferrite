import {SourceFile} from '../../project/SourceFile.js';

/** Converts rustc UTF-8 locations to editor UTF-16 without matching external filenames by suffix. */
export class NativeDiagnosticMapper {
  static offset(text, byteOffset) {
    let bytes=0,offset=0;
    for(const char of text){const size=new TextEncoder().encode(char).length;if(bytes+size>byteOffset)break;bytes+=size;offset+=char.length;}
    return offset;
  }
  static path(file,root,cwd=root) {
    let path=file.replaceAll('\\','/');
    if(!root)return path;
    const prefix=root.replaceAll('\\','/').replace(/\/$/,'')+'/';
    if(path.startsWith('/')||/^[a-zA-Z]:/.test(path)){
      if(!path.startsWith(prefix))return null;
      path=path.slice(prefix.length);
    }else{
      const working=cwd.replaceAll('\\','/').replace(/\/$/,'')+'/';
      if(!working.startsWith(prefix))return null;
      path=working.slice(prefix.length)+path;
    }
    const parts=[];
    for(const part of path.split('/')){
      if(!part||part==='.')continue;
      if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);
    }
    return parts.join('/');
  }
  static map(diagnostic,files,{root,cwd}={}) {
    const native=diagnostic.spans?.find(s=>s.primary)??diagnostic.spans?.[0];
    if(!native)return {...diagnostic,span:null};
    const normalized=this.path(native.file,root,cwd);
    if(normalized===null)return {...diagnostic,span:null,external:true};
    const candidates=Object.keys(files).filter(file=>normalized===file||(!root&&normalized.endsWith('/'+file)));
    const path=candidates.sort((a,b)=>b.length-a.length)[0];
    if(!path)return {...diagnostic,span:null};
    const text=files[path],source=new SourceFile(path,text),start=this.offset(text,native.byteStart),end=this.offset(text,native.byteEnd);
    return {...diagnostic,span:source.span(start,end)};
  }
}
