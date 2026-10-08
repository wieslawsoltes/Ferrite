import {mkdtemp,open,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {NativeSourceMapper} from './NativeSourceMapper.js';

/** Owns one compiler emission directory, bounded reads and provenance of actual rustc output. */
export class NativeArtifactCollector {
  static formats=[['mir','program.mir','text'],['llvm-ir','program.ll','text'],['asm','program.s','text'],['obj','program.o','binary']];
  constructor(directory,{maxTextBytes=750_000,maxBinaryBytes=1_000_000}={}){this.directory=directory;this.maxTextBytes=maxTextBytes;this.maxBinaryBytes=maxBinaryBytes;}
  static async create(options){return new NativeArtifactCollector(await mkdtemp(join(tmpdir(),'ferrite-emission-')),options);}
  arguments(){return ['-Cdebuginfo=2','--emit='+NativeArtifactCollector.formats.map(([kind,name])=>kind+'='+join(this.directory,name)).join(',')];}
  async collect(root,files){
    const mapper=new NativeSourceMapper(root,files),artifacts=[];
    for(const [kind,name,format] of NativeArtifactCollector.formats){
      let handle;try{handle=await open(join(this.directory,name),constants.O_RDONLY|(constants.O_NOFOLLOW??0));}catch(error){if(error.code==='ENOENT')continue;throw error;}
      try{
        const stat=await handle.stat();if(!stat.isFile())throw Error('Compiler output must be a regular file');
        const limit=format==='text'?this.maxTextBytes:this.maxBinaryBytes;
        if(format==='binary'&&stat.size>limit){artifacts.push({kind,name,format,size:stat.size,omitted:true,reason:`Binary exceeds ${limit} bytes; not downloaded or partially represented`});continue;}
        const buffer=Buffer.alloc(Math.min(stat.size,limit));let length=0;
        while(length<buffer.length){const read=await handle.read(buffer,length,buffer.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead;}
        const bytes=buffer.subarray(0,length),truncated=stat.size>length;
        const common={kind,name,format,size:stat.size,capturedBytes:length,truncated,sha256Captured:createHash('sha256').update(bytes).digest('hex')};
        if(format==='text'){
          const content=new TextDecoder('utf-8').decode(bytes,{stream:truncated});
          artifacts.push({...common,content,mappings:mapper.map(kind,content),mappingPrecision:'source-line'});
        }else artifacts.push({...common,encoding:'base64',content:bytes.toString('base64')});
      }finally{await handle.close();}
    }return artifacts;
  }
  async dispose(){await rm(this.directory,{recursive:true,force:true});}
}
