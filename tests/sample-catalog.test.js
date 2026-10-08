import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {SampleCatalog} from '../src/ui/model/SampleCatalog.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
for(const sample of SampleCatalog.projects){
  test('IDE sample: '+sample.name,()=>{
    const session=new CompilerSession();
    if(sample.error){assert.throws(()=>session.compile(sample.files),e=>e.code===sample.error);return;}
    if(sample.native){assert.throws(()=>session.compile(sample.files));return;}
    const build=session.compile(sample.files);const actual=new MirVirtualMachine(build.optimizedMir,{entry:build.entry}).run().output;
    let generated;vm.runInNewContext(build.js,{postMessage:x=>generated=x},{timeout:1000});assert.equal(actual,generated);
    if(sample.expected!==undefined)assert.equal(actual,sample.expected);
  });
}
