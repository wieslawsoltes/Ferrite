#!/usr/bin/env node
/** Installed-toolchain acceptance: real Git checkout, Cargo path+Git dependencies,
 * build.rs output, a proc macro, binary assets, stdin and serial/parallel parity.
 * No registry/network access is needed; Git dependencies use a local test origin.
 */
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProcessRunner} from '../src/native/ProcessRunner.js';
import {RepositoryManager} from '../src/native/repository/RepositoryManager.js';
const root=await mkdtemp(join(tmpdir(),'ferrite-native-acceptance-')),processRunner=new ProcessRunner(),manager=new RepositoryManager({allowedRoots:[root],jobs:2});
const write=async(path,text)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
const run=async(executable,args,cwd=root)=>{const result=await processRunner.run(executable,args,{cwd});assert.equal(result.exitCode,0,result.stderr);return result;};
try{
  await run('cargo',['--version']);
  await write('origin/Cargo.toml','[package]\nname="git-math"\nversion="0.1.0"\nedition="2021"\n');
  await write('origin/src/lib.rs','pub fn value()->i32{40}\n');
  await run('git',['init'],join(root,'origin'));await run('git',['add','.'],join(root,'origin'));
  await run('git',['-c','user.name=Ferrite test','-c','user.email=test@example.invalid','commit','-m','fixture'],join(root,'origin'));
  await write('app/Cargo.toml',`[package]\nname="native-app"\nversion="0.1.0"\nedition="2021"\nbuild="build.rs"\n[dependencies]\ngit-math={git="file://${root}/origin"}\nderive-answer={path="../derive-answer"}\n`);
  await write('derive-answer/Cargo.toml','[package]\nname="derive-answer"\nversion="0.1.0"\nedition="2021"\n[lib]\nproc-macro=true\n');
  await write('derive-answer/src/lib.rs','extern crate proc_macro;use proc_macro::TokenStream;#[proc_macro]pub fn answer(_:TokenStream)->TokenStream{"2".parse().unwrap()}');
  await write('app/build.rs','fn main(){std::fs::write(std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("built.rs"),"const BUILT: usize = 3;").unwrap();println!("cargo:rerun-if-changed=build.rs");}');
  await write('app/asset.bin',Buffer.from([0,255,128]));
  await write('app/src/main.rs','use std::io;include!(concat!(env!("OUT_DIR"),"/built.rs"));fn main(){let mut s=String::new();io::stdin().read_line(&mut s).unwrap();println!("{} {} {} {}",git_math::value()+derive_answer::answer!(),BUILT,include_bytes!("../asset.bin").len(),s.trim());}');
  let session=await manager.open({kind:'local',path:join(root,'app'),trust:true});
  assert(session.omitted.some(value=>value.path==='asset.bin'));
  const results=[];
  for(const jobs of [1,2]){
    const clean=await manager.run({...session,command:'clean',json:false,jobs:1});session=clean.repository;assert.equal(clean.exitCode,0,clean.stderr);
    const build=await manager.run({...session,command:'build',json:true,jobs,args:['--timings']});session=build.repository;assert.equal(build.exitCode,0,build.stderr);assert.equal(build.buildSummary.jobs,jobs);assert(build.timingReport.html);
    const operation=manager.run({...session,command:'run',json:false,jobs});
    for(let attempt=0;!manager.get(session.id).runner.input&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,20));
    manager.input(session.id,'hello\n');const result=await operation;session=result.repository;assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'42 3 3 hello\n');results.push(result.stdout);
  }
  assert.equal(results[0],results[1]);
  await manager.close(session.id);
  console.log('PASS installed Cargo: Git + external path dependency, procedural macro, build.rs, binary asset, stdin, jobs 1/2 output parity and actual timing report');
}finally{await manager.dispose();await rm(root,{recursive:true,force:true});}
