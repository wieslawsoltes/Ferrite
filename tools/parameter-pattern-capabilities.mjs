import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {compile} from '../src/engine.js';
import {parameterPatternCapabilityCases,parameterPatternRegionSafetyCases} from '../tests/fixtures/parameter-patterns.js';

// Reviewed repository fixtures only; this native compiler runner is not a
// sandbox or an endpoint for untrusted submitted programs.
let output='artifacts/language/parameter-pattern-capabilities.json';
for(let i=2;i<process.argv.length;i++){
  if(process.argv[i]==='--output'&&process.argv[i+1])output=process.argv[++i];
  else throw Error(`Unknown or incomplete argument: ${process.argv[i]}`);
}
const rustc=process.env.RUSTC||'rustc';
const invoke=args=>{
  const result=spawnSync(rustc,args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
  if(result.error)throw result.error;
  if(result.signal||result.status===null)throw Error(`rustc terminated: ${result.signal??'unknown status'}`);
  return result;
};
const report={schema:1,nativeValidated:false,node:process.version,
  configuration:{edition:'2024',nativeOptLevels:[0,3],overflowChecks:'on',browserOptimize:[false,true]},cases:[]};
const save=()=>{mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');};
let directory;
try{
  const version=invoke(['--version','--verbose']);assert.equal(version.status,0,version.stderr);report.rustc=version.stdout.trim();
  directory=mkdtempSync(join(tmpdir(),'ferrite-parameter-capabilities-'));
  for(const [kind,fixtures,nativeAccepted] of [
    ['native-valid-capability',parameterPatternCapabilityCases,true],
    ['native-rejected-region-safety',parameterPatternRegionSafetyCases,false]
  ])for(const [name,source,code] of fixtures){
    const evidence={name,kind,sourceSha256:createHash('sha256').update(source).digest('hex'),browserCode:code,checks:[],passed:false};
    report.cases.push(evidence);
    for(const optimize of [false,true]){
      assert.throws(()=>compile(source,{optimize}),{code},`${name}, browser optimize=${optimize}`);
      evidence.checks.push({backend:'browser',optimize,accepted:false,code});
    }
    const file=join(directory,'fixture.rs'),binary=join(directory,process.platform==='win32'?'fixture.exe':'fixture');writeFileSync(file,source);
    for(const optimization of [0,3]){
      const native=invoke([file,'--edition=2024','--crate-name','ferrite_parameter_capability',
        '-C',`opt-level=${optimization}`,'-C','overflow-checks=on','-A','warnings','-o',binary]);
      assert.equal(native.status===0,nativeAccepted,`${name}, rustc opt=${optimization}\n${native.stderr}`);
      evidence.checks.push({backend:'rustc',optimization,accepted:native.status===0,diagnostics:native.stderr});
    }
    evidence.passed=true;console.log(`passed: ${kind}: ${name}`);
  }
  report.nativeValidated=true;report.passed=report.cases.length;report.failed=0;save();
}catch(error){report.error=error.message;report.passed=report.cases.filter(c=>c.passed).length;report.failed=1;save();throw error;}
finally{if(directory)rmSync(directory,{recursive:true,force:true});}
