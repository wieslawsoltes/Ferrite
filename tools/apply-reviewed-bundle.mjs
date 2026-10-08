// Temporary rewrite transport. Source files are committed only after CI passes.
import {readFile, writeFile, mkdir, readdir, rm, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname, resolve} from 'node:path';
const root=process.cwd(), directory='.github/rewrite';
const hash=value=>createHash('sha256').update(value).digest('hex');
const bundles=(await readdir(directory)).filter(name=>/^\d+-[a-z-]+\.b64$/.test(name)).sort();
if(!bundles.length)throw Error('No source bundle found');
const messages=[];
for(const name of bundles){
 const path=`${directory}/${name}`;
 const encoded=await readFile(path,'utf8');
 if(encoded.length>10000000)throw Error('Oversized source bundle');
 const patch=JSON.parse(gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:25000000}));
 if(patch.format!=='ferrite-reviewed-patch-v1'||!Array.isArray(patch.files)||patch.files.length>500)throw Error('Invalid source bundle');
 if(typeof patch.message!=='string'||/[\r\n]/.test(patch.message))throw Error('Invalid commit message');
 const seen=new Set();
 for(const file of patch.files){
  if(typeof file.path!=='string'||file.path.includes('..')||!file.path.match(/^(?:src\/|tests\/|tools\/|docs\/|examples\/|styles\/|\.github\/workflows\/|index\.html$|package(?:-lock)?\.json$|README\.md$|\.gitignore$|compiler\.js$|examples\.js$)/)||seen.has(file.path))throw Error('Invalid source path');
  seen.add(file.path);
  const target=resolve(root,file.path);
  if(!target.startsWith(root+'/'))throw Error('Path escapes repository');
  let actual=null;
  try{if((await lstat(target)).isSymbolicLink())throw Error('Symlink rejected');actual=hash(await readFile(target));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(actual!==file.before)throw Error(`Concurrent change to ${file.path}: refusing to overwrite it`);
  if(file.content!==null&&typeof file.content!=='string')throw Error('Invalid source content');
 }
 for(const file of patch.files){
  const target=resolve(root,file.path);
  if(file.content===null)await rm(target);
  else{await mkdir(dirname(target),{recursive:true});await writeFile(target,file.content,'utf8');}
 }
 await rm(path);messages.push(patch.message);
 console.log(`Applied ${patch.files.length} hash-verified source changes from ${name}`);
}
if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`message=${messages.join('; ')}\n`,{flag:'a'});
