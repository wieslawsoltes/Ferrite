import {open, realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve, relative, isAbsolute, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {CargoOutputParser} from './CargoOutputParser.js';
import {createNativeWasmHost} from '../ui-framework/NativeWasm.js';
import {UI} from '../ui-framework/Runtime.js';

/** Collect complete, bounded rustc Wasm artifacts, never partial executable bytes. */
export class NativeUIArtifact {
  static async collect(stdout, root) {
    const directory = await realpath(resolve(root,'target')), artifacts = [], seen = new Set();
    const files = CargoOutputParser.parse(stdout).artifacts.flatMap(a=>a.filenames).filter(f=>f.endsWith('.wasm'));
    for (const filename of files) {
      const path = await realpath(filename), rel = relative(directory,path);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Cargo UI output escaped its target directory');
      if (seen.has(path)) continue; seen.add(path);
      const file = await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try {
        const stat=await file.stat();
        if (!stat.isFile() || stat.size<8 || stat.size>8*1024*1024) throw Error('Native UI artifact exceeds its 8 MiB budget');
        const bytes=Buffer.alloc(stat.size);let length=0;
        while(length<bytes.length){const part=await file.read(bytes,length,bytes.length-length,length);if(!part.bytesRead)break;length+=part.bytesRead;}
        if(length!==stat.size || (await file.stat()).size!==stat.size)throw Error('Native UI output changed while reading');
        createNativeWasmHost(UI).validate(bytes);
        const module=new WebAssembly.Module(bytes), exports=new Set(WebAssembly.Module.exports(module).map(e=>e.name));
        if (!['memory','ferrite_ui_abi','ferrite_start','ferrite_render','ferrite_commit','ferrite_dispatch','ferrite_dispose'].every(n=>exports.has(n))) throw Error('Cargo cdylib does not implement the native UI ABI');
        artifacts.push({kind:'native-ui-wasm',name:basename(path),format:'binary',encoding:'base64',size:bytes.length,capturedBytes:bytes.length,truncated:false,sha256Captured:createHash('sha256').update(bytes).digest('hex'),content:bytes.toString('base64')});
      } finally {await file.close();}
    }
    if(!artifacts.length) throw Error('Cargo produced no native UI cdylib artifact');
    return artifacts;
  }
}
