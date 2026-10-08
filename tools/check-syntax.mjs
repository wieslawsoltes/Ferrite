import {readdir} from "node:fs/promises";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const roots=["src","tests","tools"];
let count=0;
async function walk(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
   const path=join(directory,entry.name);
   if(entry.isDirectory()){await walk(path);continue;}
   if(!/\.(?:js|mjs)$/.test(entry.name))continue;
   const child=spawnSync(process.execPath,["--check",path],{encoding:"utf8"});
   if(child.status!==0){process.stderr.write(child.stderr);throw Error("Syntax failure: "+path);}
   count++;
 }
}
for(const root of roots)await walk(root);
console.log("Verified JavaScript syntax for "+count+" source/test/tool modules.");
