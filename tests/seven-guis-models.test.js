import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compile} from '../src/engine.js';
import {JavaScriptEmitter} from '../src/compiler/JavaScriptEmitter.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyEmitter} from '../src/compiler/wasm/WebAssemblyEmitter.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';

const builds=new Map();
function model(name,backend){
  let build=builds.get(name);if(!build){build=compile(fs.readFileSync(new URL(`../examples/7guis/${name}/model.rs`,import.meta.url),'utf8'),{mode:'library'});builds.set(name,build);}
  const options={maxSteps:2_000_000,maxTrace:0};let program;
  if(backend==='javascript')program=new Function(new JavaScriptEmitter(build.optimizedMir,{library:true,runtime:options}).build().code)();
  else if(backend==='wasm')program=new WebAssemblyRuntime(new WebAssemblyEmitter(build.optimizedMir,{entry:null}).build(),options);
  return (name,...args)=>{
    if(backend==='mir'){const vm=new MirVirtualMachine(build.optimizedMir,{...options,entry:name+'<>',args});vm.run();return vm.result;}
    program.runtime.steps=0;return (backend==='javascript'?program.functions:program.instance.exports)[name+'<>'](...args);
  };
}
for(const backend of ['javascript','mir','wasm']){
  test(`${backend}: temperatures preserve invalid edited input and the opposite value`,()=>{
    const m=model('temperature',backend);let s=m('initial');assert.deepEqual({...s},{celsius:'',fahrenheit:''});
    s=m('change',s,'100',true);assert.equal(s.fahrenheit,'212');s=m('change',s,'32',false);assert.equal(s.celsius,'0');
    for(const text of ['','hello','NaN','Infinity','1e999','1,2','0x10','1junk']){s=m('change',s,text,true);assert.equal(s.celsius,text);assert.equal(s.fahrenheit,'32');}
    s=m('change',s,' -40 ',true);assert.equal(s.fahrenheit,'-40');
  });
  test(`${backend}: strict Gregorian dates and flight constraints`,()=>{
    const m=model('flight',backend);for(const text of ['29.02.1900','31.04.2026','1.01.2026','00.01.2026','10.13.2026','10.01.0000',' 10.01.2026','10/01/2026'])assert.equal(m('date',text).tag,'Option::None',text);
    assert.equal(m('date','29.02.2000').values[0],20000229n);assert.equal(m('allowed','10.10.2026','invalid',false),true);
    assert.equal(m('allowed','10.10.2026','09.10.2026',true),false);assert.equal(m('allowed','10.10.2026','10.10.2026',true),true);
  });
  test(`${backend}: timer decrease, completion, resume, invalid tick`,()=>{
    const m=model('timer',backend);let s=m('tick',{elapsed:0,duration:1},700);assert.equal(s.elapsed,.7);
    s.duration=.5;s=m('tick',s,400);assert.equal(s.elapsed,.7);s.duration=1;s=m('tick',s,400);assert.equal(s.elapsed,1);
    s.duration=5;s=m('tick',s,1000);assert.equal(s.elapsed,2);for(const delta of [-1,NaN,Infinity]){s=m('tick',s,delta);assert.equal(s.elapsed,2);}
  });
  test(`${backend}: CRUD record IDs remain stable through updates/deletions`,()=>{
    const m=model('crud',backend);let s=m('initial');s=m('delete',s,0n);s=m('create',s,'Ada','Lovelace');
    assert.deepEqual(s.rows.map(row=>row.id),[1n,2n,3n]);s=m('update',s,2n,'Changed','Surname');assert.equal(s.rows[1].name,'Changed');
    s=m('delete',s,2n);s=m('create',s,'Grace','Hopper');assert.deepEqual(s.rows.map(row=>row.id),[1n,3n,4n]);
    s=m('update',s,99n,'Ignored','Ignored');assert.equal(s.rows.length,3);
  });
  test(`${backend}: circle nearest selection and transactional undo/redo`,()=>{
    const m=model('circles',backend);let s=m('initial');s=m('create',s,100,100);s=m('create',s,112,100);
    // Reference arguments are runtime references; all public mutation functions take owned data.
    // Hit-testing is also exercised through real SVG pointer events in Chromium.
    assert.equal(s.cursor,2n);s=m('preview',s,0n,80);s=m('preview',s,0n,90);assert.equal(s.cursor,2n);
    s=m('finish',s,0n,30);assert.equal(s.cursor,3n);s=m('undo',s);assert.equal(s.circles[0].diameter,30);
    s=m('redo',s);assert.equal(s.circles[0].diameter,90);s=m('undo',s);s=m('create',s,250,200);assert.equal(s.history.length,3);
    s=m('redo',s);assert.equal(s.circles.length,3);s=m('undo',s);assert.equal(s.circles.length,2);
    s=m('finish',s,0n,30);assert.equal(s.history.length,3);s=m('redo',s);assert.equal(s.circles.length,3);
  });
  test(`${backend}: Cells evaluates expression/range grammar and explicit errors`,()=>{
    const m=model('cells',backend);let s=m('initial');const set=(i,text)=>s=m('set',s,BigInt(i),text);
    set(0,'4');set(1,'6');set(2,'=sum(A0:B0)*2 + -(3-1)');assert.equal(s.cells[2].display,'18');
    set(3,'=avg(A0:B0)');assert.equal(s.cells[3].display,'5');set(4,'=prod(A0:B0)');assert.equal(s.cells[4].display,'24');
    set(5,'=div(mul(A0,3),2)');assert.equal(s.cells[5].display,'6');set(6,'=1.25e2 + .5');assert.equal(s.cells[6].display,'125.5');
    for(const [text,error] of [['=A100','#REF!'],['=AA0','#REF!'],['=NOPE(2)','#NAME?'],['=1/0','#DIV/0!'],['=1e999','#NUM!'],['=(1+','#ERROR!']]){set(8,text);assert.equal(s.cells[8].display,error,text);}
    set(9,'text <script>');assert.equal(s.cells[9].display,'text <script>');set(10,'=J0+1');assert.equal(s.cells[10].display,'#VALUE!');
    set(11,'=sum(Z99:Z99)');assert.equal(s.cells[11].display,'0');assert.equal(m('label',2599n),'Z99');
  });
  test(`${backend}: Cells updates only the dependent closure and removes obsolete edges`,()=>{
    const m=model('cells',backend);let s=m('initial');const set=(i,text)=>s=m('set',s,BigInt(i),text);
    set(0,'2');set(1,'=A0+1');set(2,'=A0+2');set(3,'=B0+C0');set(25,'unrelated');
    set(0,'3');assert.equal(s.cells[3].display,'9');assert.equal(s.evaluations,4n);
    set(0,'3');assert.equal(s.evaluations,0n);set(1,'=Z99+1');set(0,'4');assert.equal(s.evaluations,3n);assert.equal(s.cells[3].display,'7');
    assert.deepEqual(s.users[0],[2n]);
  });
  test(`${backend}: Cells cycles and downstream errors recover after edge removal`,()=>{
    const m=model('cells',backend);let s=m('initial');const set=(i,text)=>s=m('set',s,BigInt(i),text);
    set(0,'=B0');set(1,'=A0');set(2,'=A0+1');assert.deepEqual(s.cells.slice(0,3).map(c=>c.display),['#CYCLE!','#CYCLE!','#CYCLE!']);
    set(1,'5');assert.deepEqual(s.cells.slice(0,3).map(c=>c.display),['5','5','6']);assert.equal(s.evaluations,3n);
    set(0,'=A0');assert.equal(s.cells[0].display,'#CYCLE!');set(0,'=A100');assert.equal(s.cells[0].display,'#REF!');
    assert.equal(s.cells[2].display,'#REF!');set(0,'7');assert.equal(s.cells[2].display,'8');
  });
}
