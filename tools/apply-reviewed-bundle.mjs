// Temporary rewrite transport. Removed after the reviewed source batches are committed.
import {readFile, writeFile, mkdir, readdir, rm, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync, brotliDecompressSync} from 'node:zlib';
import {dirname, resolve} from 'node:path';
const root=process.cwd(), directory='.github/rewrite';
const hash=value=>createHash('sha256').update(value).digest('hex');
const bundles=(await readdir(directory)).filter(name=>/^\d+-[a-z-]+\.b64$/.test(name)).sort();
if(!bundles.length)throw Error('No source bundle found');
const messages=[];
for(const name of bundles){
 const path=`${directory}/${name}`;
 let encoded=await readFile(path,'utf8'), parts=[], codec='gzip', digest=null;
 if(encoded.startsWith('{')){
  const manifest=JSON.parse(encoded);parts=manifest.parts;codec=manifest.codec;digest=manifest.sha256;
  if(!Array.isArray(parts)||parts.length>100||parts.some(p=>!/^\d+-\d+\.part$/.test(p)))throw Error('Invalid source parts');
  encoded=(await Promise.all(parts.map(p=>readFile(`${directory}/${p}`,'utf8')))).join('');
 }
 if(encoded.length>10000000)throw Error('Oversized source bundle');
 const bytes=Buffer.from(encoded,'base64');
 if(digest&&hash(bytes)!==digest)throw Error('Source transport checksum mismatch');
 const decode=codec==='brotli'?brotliDecompressSync:gunzipSync;
 const patch=JSON.parse(decode(bytes,{maxOutputLength:25000000}));
 if(patch.format!=='ferrite-reviewed-patch-v1'||!Array.isArray(patch.files)||patch.files.length>500)throw Error('Invalid source bundle');
 if(typeof patch.message!=='string'||/[\r\n]/.test(patch.message))throw Error('Invalid commit message');
 const seen=new Set();
 for(const file of patch.files){
  if(typeof file.path!=='string'||file.path.includes('..')||!file.path.match(/^(?:src\/|tests\/|tools\/|docs\/|examples\/|styles\/|\.github\/workflows\/|index\.html$|package(?:-lock)?\.json$|README\.md$|\.gitignore$|compiler\.js$|examples\.js$)/)||seen.has(file.path))throw Error('Invalid source path');
  seen.add(file.path);
  const target=resolve(root,file.path);
  if(!target.startsWith(root+'/'))throw Error('Path escapes repository');
  let actual=null, original=null;
  try{if((await lstat(target)).isSymbolicLink())throw Error('Symlink rejected');original=await readFile(target);actual=hash(original);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(actual!==file.before)throw Error(`Concurrent change to ${file.path}: refusing to overwrite it`);
  if(file.edits!==undefined){
   if(!original||!Array.isArray(file.edits)||file.edits.length>10000)throw Error('Invalid source edits');
   const chunks=[];let cursor=0;
   for(const edit of file.edits){
    if(!Number.isSafeInteger(edit.start)||!Number.isSafeInteger(edit.end)||edit.start<cursor||edit.end<edit.start||edit.end>original.length||typeof edit.text!=='string')throw Error('Invalid source edit range');
    chunks.push(original.subarray(cursor,edit.start),Buffer.from(edit.text,'utf8'));cursor=edit.end;
   }
   chunks.push(original.subarray(cursor));const output=Buffer.concat(chunks);
   if(hash(output)!==file.after)throw Error('Source edit output checksum mismatch');
   file.content=output.toString('utf8');
  }
  if(file.content!==null&&typeof file.content!=='string')throw Error('Invalid source content');
 }
 for(const file of patch.files){
  const target=resolve(root,file.path);
  if(file.content===null)await rm(target);
  else{await mkdir(dirname(target),{recursive:true});await writeFile(target,file.content,'utf8');}
 }
 await rm(path);for(const part of parts)await rm(`${directory}/${part}`);messages.push(patch.message);
 console.log(`Applied ${patch.files.length} hash-verified source changes from ${name}`);
}
if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`message=${messages.join('; ')}\n`,{flag:'a'});
