import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/engine.js';
import {Runtime} from '../src/runtime/Runtime.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {JavaScriptEmitter} from '../src/compiler/JavaScriptEmitter.js';
import {WebAssemblyEmitter} from '../src/compiler/wasm/WebAssemblyEmitter.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {UICompiler} from '../src/ui-framework/UICompiler.js';
import {UISession} from '../src/ui-framework/UISession.js';
import {createUIRuntime} from '../src/ui-framework/Runtime.js';
import {createDocument,elements} from './fixtures/ui-dom.js';

const source=`fn main() -> i64 {
    assert_eq!("+42".parse::<i64>().unwrap(),42_i64);
    assert!("18446744073709551616".parse::<u64>().is_err());
    assert_eq!("18446744073709551615".parse::<u64>().unwrap(),18446744073709551615_u64);
    assert!("-1".parse::<u8>().is_err()); assert!(" 1".parse::<f64>().is_err());
    assert!("1e".parse::<f64>().is_err()); assert!("0xff".parse::<f64>().is_err());
    assert_eq!("-1.25e2".parse::<f64>().unwrap(),-125.0);
    assert!(!"NaN".parse::<f64>().unwrap().is_finite());
    assert_eq!("  2.5  ".trim().parse::<f64>().unwrap(),2.5);
    let text=String::from("Zażółć 🦀"); assert_eq!(text.clone().into_bytes().len(),15_usize);
    assert!(text.starts_with("Za")); assert!(text.contains("🦀"));
    assert_eq!("aBc".to_ascii_uppercase(),String::from("ABC"));
    let mut numbers=vec![3_i64,7_i64,9_i64]; assert_eq!(numbers.remove(1),7_i64);
    assert_eq!(numbers.len(),2_usize); assert_eq!(numbers[1],9_i64);
    let mut name=String::from("Ru");name.push('s');name.push_str("t");assert!(name=="Rust");
    42
}`;
for(const backend of ['javascript','mir','wasm'])test(`${backend}: checked numeric parsing and owned text/vector methods`,()=>{
  const build=compile(source);
  if(backend==='javascript'){const program=new Function(new JavaScriptEmitter(build.optimizedMir,{library:true}).build().code)();assert.equal(program.functions[build.entry](),42n);}
  else if(backend==='wasm'){const binary=new WebAssemblyEmitter(build.optimizedMir,{entry:build.entry}).build();assert.equal(new WebAssemblyRuntime(binary).run().value,42n);}
  else{const vm=new MirVirtualMachine(build.optimizedMir,{entry:build.entry});vm.run();assert.equal(vm.result,42n);}
});
test('invalid parser metadata and out-of-bounds removal trap rather than mutating data',()=>{
  const runtime=new Runtime();assert.throws(()=>runtime.parseNumber('1','opaque'),/descriptor/);
  const data=[1n];assert.throws(()=>runtime.builtin('method::remove',[2n],{receiver:data}),/bounds/);assert.deepEqual(data,[1n]);
  assert.throws(()=>compile('fn main(){let s=String::from("x");let r=&s;r.into_bytes();}'),/borrowed receiver/);
  assert.throws(()=>compile('fn main(){let v=vec![1];v.remove(0);}'),/mutable/);
  assert.throws(()=>compile('fn main(){"x".parse::<String>();}'),/FromStr/);
});
test('derived nominal fields resolve in their declaration module and returning branches do not poison continuing moves',()=>{
  const code=`mod domain {#[derive(Clone)] pub struct Row {pub value:String} #[derive(Clone)] pub struct Model {pub rows:Vec<Row>} pub fn change(m:Model,done:bool)->Model {if done{return m;} m.clone()}}
  fn app()->ui::Node {let s=ui::state(domain::Model{rows:vec![domain::Row{value:String::from("ok")}]});let m=domain::change(ui::read(s),false);view!{<p>{m.rows[0].value.clone()}</p>}}`;
  const artifact=UICompiler.compile(code);const root=createDocument().createElement('main');const session=new UISession(artifact).mount(root);
  assert.equal(root.textContent,'ok');session.dispose();
});
for(const backend of ['javascript','mir','wasm'])test(`${backend}: lazy state and managed timer registration survive rerender and dispose`,()=>{
  const previousSet=globalThis.setInterval,previousClear=globalThis.clearInterval;let tick,created=0,cleared=0;
  globalThis.setInterval=callback=>{tick=callback;created++;return 17;};globalThis.clearInterval=id=>{assert.equal(id,17);cleared++;};
  const ui=createUIRuntime(),container=createDocument().createElement('main');let session;
  try{
    const artifact=UICompiler.compile(`fn app()->ui::Node {let state:ui::Signal<i64>=ui::state_with(||7_i64);let copy=state.clone();ui::interval(25,move |_delta:f64|ui::modify(copy,|n|n+1));view!{<output>{ui::read(state)}</output>}}`);
    session=new UISession(artifact,{backend,runtime:ui}).mount(container);session.root.flushEffects();assert.equal(created,1);
    tick();ui.flushSync();session.root.flushEffects();assert.equal(elements(container,'output')[0].textContent,'8');assert.equal(created,1);
    session.armDebugger();tick();ui.flushSync();assert.equal(elements(container,'output')[0].textContent,'8');session.debug('stop');
    session.dispose();assert.equal(cleared,1);tick();assert.equal(session.handles.size,0);
  }finally{session?.dispose();globalThis.setInterval=previousSet;globalThis.clearInterval=previousClear;}
});
