import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,lstatSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
const [payloadPath,expectedDigest]=process.argv.slice(2);
const root=process.cwd();
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const raw=Buffer.from(readFileSync(payloadPath,'utf8').trim(),'base64');
if(createHash('sha256').update(raw).digest('hex')!==expectedDigest)throw Error('Source transport checksum mismatch');
const plan=JSON.parse(brotliDecompressSync(raw,{maxOutputLength:1_000_000}));
if(plan.format!=='ferrite-six-commits-v1'||plan.commits.length!==6||plan.base!=='3306b9db4f34c6d57a578190b85e136ff1055384')throw Error('Unexpected publication plan');
if(git('status','--porcelain')||git('rev-parse','HEAD^{tree}')!=='1aa65eaec8bc6c87b073c309eb0d716ccd61fd2b')throw Error('Expected clean reviewed baseline');
for(const commit of plan.commits){
 for(const file of commit.files){
  if(!/^(src\/|tests\/|tools\/|styles\/|docs\/|examples\/|README\.md$|package\.json$|\.github\/workflows\/test\.yml$)/.test(file.path)||file.path.split('/').some(p=>!p||p==='.'||p==='..')||file.path.includes('\\'))throw Error('Invalid source path');
  const target=resolve(root,file.path);
  if(relative(root,target).startsWith('..'))throw Error('Path escapes checkout');
  for(let p=target;p!==root;p=dirname(p))if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('Source symlink');
  let output;
  if(file.edits){
   const original=readFileSync(target),pieces=[];let cursor=0;
   for(const [start,end,text] of file.edits){
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<cursor||end<start||end>original.length||typeof text!=='string')throw Error('Invalid exact source edit');
    pieces.push(original.subarray(cursor,start),Buffer.from(text));cursor=end;
   }
   pieces.push(original.subarray(cursor));output=Buffer.concat(pieces);
  }else if(file.base64!==undefined)output=Buffer.from(file.base64,'base64');
  else output=file.content===null?null:Buffer.from(file.content);
  if(output===null)rmSync(target);else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,output);}
 }
 execFileSync(process.execPath,['tools/bundle-workers.mjs'],{cwd:root,stdio:'inherit'});
 git('add','-A');
 const tree=git('write-tree');
 if(tree!==commit.tree)throw Error(`Reviewed tree mismatch: ${commit.message}: ${tree} expected ${commit.tree}`);
 git('commit','--author',commit.author,'--date',commit.date,'-m',commit.message);
 console.log(`Restored ${git('rev-parse','HEAD')}: ${commit.message}`);
}
if(git('rev-parse','HEAD^{tree}')!==plan.finalTree||git('status','--porcelain'))throw Error('Publication tree mismatch');
console.log(`VERIFIED FINAL TREE ${plan.finalTree}`);
