import {SourceFile} from '../../project/SourceFile.js';
/** rustc offsets are UTF-8 bytes; browser selections use UTF-16 string offsets. */
export class NativeDiagnosticMapper {
  static offset(text,byteOffset){let bytes=0,offset=0;for(const char of text){const size=new TextEncoder().encode(char).length;if(bytes+size>byteOffset)break;bytes+=size;offset+=char.length;}return offset;}
  static map(diagnostic,files,{root}={}){const native=diagnostic.spans?.find(s=>s.primary)??diagnostic.spans?.[0];if(!native)return {...diagnostic,span:null};let normalized=native.file.replaceAll('\\','/');if(root){const prefix=root.replaceAll('\\','/').replace(/\/$/,'')+'/';if(normalized.startsWith('/')||/^[a-zA-Z]:/.test(normalized)){if(!normalized.startsWith(prefix))return {...diagnostic,span:null,external:true};normalized=normalized.slice(prefix.length);}if(normalized.split('/').includes('..'))return {...diagnostic,span:null,external:true};}
    const candidates=Object.keys(files).filter(file=>normalized===file||(!root&&normalized.endsWith('/'+file)));const path=candidates.sort((a,b)=>b.length-a.length)[0];if(!path)return {...diagnostic,span:null};const text=files[path],source=new SourceFile(path,text),start=this.offset(text,native.byteStart),end=this.offset(text,native.byteEnd);return {...diagnostic,span:source.span(start,end)};}
}
