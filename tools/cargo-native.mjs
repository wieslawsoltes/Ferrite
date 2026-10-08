#!/usr/bin/env node
/**
 * Local native Cargo adapter for an exported Ferrite project snapshot.
 * This is intentionally a CLI, NOT an unauthenticated HTTP execution service.
 */
import {readFile,mkdir,writeFile,rm,cp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,sep} from "node:path";
import {mkdtemp} from "node:fs/promises";
import {spawn} from "node:child_process";

export const commands=new Set(["check","build","run","test","metadata"]);
export function validateSnapshot(value) {
  if(!value||typeof value!=="object"||!value.files||typeof value.files!=="object"||Array.isArray(value.files))throw Error("Invalid Ferrite snapshot");
  const paths=Object.keys(value.files);
  if(paths.length>500)throw Error("Too many files");
  let bytes=0;
  for(const path of paths){
    if(!/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(path)||path.includes("..")||path.startsWith("/")||path.split("/").some(x=>x==="."||x===".."))throw Error("Invalid project path "+path);
    if(typeof value.files[path]!=="string")throw Error("Invalid text content "+path);
    bytes+=Buffer.byteLength(value.files[path]);
  }
  if(bytes>10*1024*1024)throw Error("Project exceeds 10 MiB");
  if(!Object.hasOwn(value.files,"Cargo.toml"))throw Error("Missing Cargo.toml");
  return value.files;
}
export async function materialize(snapshot) {
  const files=validateSnapshot(snapshot);
  const root=await mkdtemp(join(tmpdir(),"ferrite-cargo-"));
  try{
    for(const [path,contents] of Object.entries(files)){
      const output=resolve(root,path);
      if(!output.startsWith(root+sep))throw Error("Unsafe path "+path);
      await mkdir(resolve(output,".."),{recursive:true});await writeFile(output,contents,"utf8");
    }
    return root;
  }catch(error){await rm(root,{recursive:true,force:true});throw error;}
}
export async function runCargo(snapshot,command="check",{spawnProcess=spawn,timeoutMs=120000,outputDir=null}={}){
  if(!commands.has(command))throw Error("Unsupported Cargo command "+command);
  const root=await materialize(snapshot);
  const args=[command];
  if(command==="metadata")args.push("--format-version","1");
  try{const result=await new Promise((done,reject)=>{
    const child=spawnProcess("cargo",args,{cwd:root,stdio:["ignore","pipe","pipe"],env:process.env});
    let stdout="",stderr="",settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error)reject(error);else done(result);};
    const timeout=setTimeout(()=>{child.kill("SIGKILL");finish(Error("Cargo execution timed out"));},timeoutMs);
    for(const [stream,key] of [[child.stdout,"stdout"],[child.stderr,"stderr"]])stream?.on("data",chunk=>{
      if(key==="stdout")stdout+=chunk.toString();else stderr+=chunk.toString();
      if(stdout.length+stderr.length>8*1024*1024){child.kill("SIGKILL");finish(Error("Cargo output exceeds 8 MiB"));}
    });
    child.on("error",error=>finish(error));child.on("close",code=>finish(null,{exitCode:code,stdout,stderr,command}));
  });
    if(outputDir&&result.exitCode===0&&command==="build"){const out=resolve(outputDir);await mkdir(out,{recursive:true});await cp(join(root,"target"),out,{recursive:true});}
    return result;
  }finally{await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
  const options=process.argv.slice(2),file=options.includes("--snapshot")?options[options.indexOf("--snapshot")+1]:null,command=options.includes("--command")?options[options.indexOf("--command")+1]:"check",outputDir=options.includes("--output-dir")?options[options.indexOf("--output-dir")+1]:null;
  if(!file){console.error("Usage: node tools/cargo-native.mjs --snapshot project.ferrite.json --command check|build|run|test|metadata");process.exitCode=2;}
  else {try{const snapshot=JSON.parse(await readFile(file,"utf8"));const result=await runCargo(snapshot,command,{outputDir});process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.exitCode||0;}catch(e){console.error(e.message);process.exitCode=1;}}
}
