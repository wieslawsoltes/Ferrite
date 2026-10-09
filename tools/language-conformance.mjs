import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {languageCases} from '../tests/fixtures/language-conformance.js';

// The native runner only executes reviewed, repository-owned fixtures. It is
// not an endpoint for untrusted submissions and does not claim a host sandbox.
const options={browserOnly:false,output:'artifacts/language/conformance.json'};
for(let i=2;i<process.argv.length;i++) {
  const argument=process.argv[i];
  if(argument==='--browser-only') options.browserOnly=true;
  else if(argument==='--output') { options.output=process.argv[++i]; if(!options.output) throw new Error('Missing output path'); }
  else throw new Error(`Unknown argument ${argument}`);
}
const rustc=process.env.RUSTC||'rustc';
const run=(command,args,timeout=30000)=>{
  const result=spawnSync(command,args,{encoding:'utf8',timeout,maxBuffer:1024*1024});
  if(result.error) throw result.error;
  if(result.signal||result.status===null) throw new Error(`${command} terminated by ${result.signal??'an unknown signal'}`);
  return result;
};
const report={schema:1,mode:options.browserOnly?'browser-only':'rustc-differential',node:process.version,
  nativeValidated:false,configuration:{edition:'2024',nativeOptLevels:[0,3],overflowChecks:'on',browserOptimize:[false,true]},cases:[]};
const save=()=>{mkdirSync(dirname(options.output),{recursive:true});writeFileSync(options.output,JSON.stringify(report,null,2)+'\n');};
let directory;
try {
  if(!options.browserOnly) {
    const version=run(rustc,['--version','--verbose']);
    assert.equal(version.status,0,version.stderr);report.rustc=version.stdout.trim();
    directory=mkdtempSync(join(tmpdir(),'ferrite-rustc-conformance-'));
  }
  for(const fixture of languageCases) {
    const start=performance.now();
    const evidence={name:fixture.name,kind:fixture.kind,sha256:createHash('sha256').update(fixture.source).digest('hex'),backends:[]};
    try {
      for(const optimize of [false,true]) {
        const label=`browser optimize=${optimize}`;
        if(fixture.kind==='compile-fail') {
          assert.throws(()=>compile(fixture.source,{optimize}),e=>/^E\d+$/.test(e.code),label);
          evidence.backends.push({backend:label,accepted:false});continue;
        }
        const compiled=compile(fixture.source,{optimize});
        const actions=[
          ['MIR',()=>new MirVirtualMachine(compiled.optimizedMir,{entry:compiled.entry,maxTrace:0}).run().output],
          ['WebAssembly',()=>new WebAssemblyRuntime(compiled.wasm).run().output],
          ['JavaScript',()=>{let output;vm.runInNewContext(compiled.js,{postMessage:value=>{output=value;}},{timeout:5000});return output;}],
        ];
        for(const [backend,action] of actions) {
          if(fixture.kind==='panic') assert.throws(action,e=>e.code===fixture.code,`${label} ${backend}`);
          else assert.equal(action(),fixture.output,`${label} ${backend}`);
          evidence.backends.push({backend,optimize,panic:fixture.kind==='panic'});
        }
      }
      if(!options.browserOnly) for(const optimization of [0,3]) {
        const source=join(directory,'fixture.rs'), binary=join(directory,process.platform==='win32'?'fixture.exe':'fixture');
        writeFileSync(source,fixture.source);
        // Arithmetic/bounds lint suppression lets runtime panic fixtures execute;
        // type checking and hard const-evaluation errors are never disabled.
        const compiled=run(rustc,[source,'--edition=2024','--crate-name','ferrite_conformance',
          '-C',`opt-level=${optimization}`,'-C','overflow-checks=on','-A','warnings',
          '-A','unconditional_panic','-A','arithmetic_overflow','-o',binary]);
        if(fixture.kind==='compile-fail') {
          assert.notEqual(compiled.status,0,`rustc unexpectedly accepted ${fixture.name}`);
          evidence.backends.push({backend:'rustc',optimization,accepted:false});continue;
        }
        assert.equal(compiled.status,0,`rustc -O${optimization}: ${compiled.stderr}`);
        const executed=run(binary,[],5000);
        assert.equal(executed.status,fixture.kind==='panic'?101:0,executed.stderr);
        if(fixture.kind==='run') assert.equal(executed.stdout,fixture.output,`rustc -O${optimization}`);
        evidence.backends.push({backend:'rustc',optimization,exitCode:executed.status,output:executed.stdout});
      }
      evidence.status='passed';
    } catch(error) { evidence.status='failed';evidence.error=String(error.stack||error).slice(0,12000);process.exitCode=1; }
    evidence.milliseconds=performance.now()-start;report.cases.push(evidence);save();
    console.log(`${evidence.status}: ${fixture.name}`);
    if(evidence.error) console.error(evidence.error);
  }
  report.passed=report.cases.filter(test=>test.status==='passed').length;
  report.failed=report.cases.length-report.passed;
  report.nativeValidated=!options.browserOnly&&report.failed===0;
} catch(error) { report.error=String(error.stack||error);process.exitCode=1;console.error(report.error); }
finally { if(directory) rmSync(directory,{recursive:true,force:true}); save(); }
console.log(JSON.stringify({mode:report.mode,passed:report.passed,failed:report.failed,nativeValidated:report.nativeValidated}));
