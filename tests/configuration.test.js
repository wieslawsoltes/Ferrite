import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/engine.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {FeatureResolver} from '../src/cargo/FeatureResolver.js';
import {cargoPlan} from '../src/cargo.js';
const manifest='[package]\nname="cfg_demo"\nversion="0.1.0"\n[features]\ndefault=[]\nfast=[]\nclone=[]';
const output=b=>new MirVirtualMachine(b.optimizedMir).run().output;
test('cfg removes inactive declarations before name/type checking and cfg! is a typed constant',()=>{
 const src='#[cfg(feature="fast")] fn speed()->i32 {20} #[cfg(not(feature="fast"))] fn speed()->i32 {2} #[cfg(false)] fn bad()->i32 {"wrong"} fn main(){println!("{} {}",speed(),cfg!(all(feature="fast",not(unix))));}';
 assert.equal(output(compile(src,{configuration:{features:['fast']}})),'20 true\n');
 assert.equal(output(compile(src)),'2 false\n');
});
test('features participate in exact project and function cache keys',()=>{
 const files={'Cargo.toml':manifest,'src/main.rs':'fn main(){println!("{}",cfg!(feature="fast"));}'};
 const session=new CompilerSession(); assert.equal(output(session.compile(files)),'false\n');
 const enabled=session.compile(files,'run',{features:['fast']});assert.equal(output(enabled),'true\n');
 assert.equal(enabled.cacheHit,false);assert.equal(output(session.compile(files)),'false\n');
});
test('inactive modules are not loaded and cfg_attr path resolves enabled external source',()=>{
 const files={'Cargo.toml':manifest,'src/main.rs':'#[cfg(false)] mod missing; #[cfg_attr(feature="fast",path="other.rs")] mod value; fn main(){println!("{}",value::number());}',
 'src/value.rs':'pub fn number()->i32 {1}','src/other.rs':'pub fn number()->i32 {9}'};
 const session=new CompilerSession(); assert.equal(output(session.compile(files)),'1\n');
 const build=session.compile(files,'run',{features:['fast']}); assert.equal(output(build),'9\n');
 assert(!build.unit.modules.includes('src/value.rs')); assert(build.unit.modules.includes('src/other.rs'));
 assert(build.stages.find(s=>s.kind==='configuration').data.some(d=>d.kind==='cfg'&&!d.enabled));
});
test('nested cfg_attr derives Copy and conditionally removes struct fields and enum variants',()=>{
 const src='#[cfg_attr(feature="clone",cfg_attr(all(),derive(Clone, Copy)))] struct P {x:i32, #[cfg(false)] y:Missing} enum E {One, #[cfg(false)] Two(Missing)} fn main(){let a=P{x:1};let b=a;println!("{} {}",a.x,b.x);}';
 assert.equal(output(compile(src,{configuration:{features:['clone']}})),'1 1\n');
 assert.throws(()=>compile(src),/moved/);
});
test('cfg test controls discovery independently of check and excludes dependency test cfg',()=>{
 const files={'Cargo.toml':manifest,'src/main.rs':'fn main(){} #[cfg(test)] #[test] fn test_only(){assert!(cfg!(test));} #[cfg(not(test))] fn normal(){}'};
 const session=new CompilerSession(); const normal=session.compile(files); assert.equal(normal.tests.length,0);
 const tests=session.compile(files,'test');assert.equal(tests.tests.length,1);assert(!tests.sem.symbols.some(s=>s.name==='normal'));
});
test('malformed cfg predicates are diagnostics rather than silently enabled',()=>{
 for(const cfg of ['not()','not(true,false)','unknown(true)','feature=7'])assert.throws(()=>compile(`#[cfg(${cfg})] fn main(){}`),e=>e.code==='F_CFG');
 assert.equal(output(compile('#[cfg_attr(true,)] fn main(){println!("{} {}",cfg!(all()),cfg!(any()));}')),'true false\n');
});
test('implicit optional dependencies, dep: suppression and weak features have distinct semantics',()=>{
 const resolver=new FeatureResolver({default:['weak'],weak:['optional?/serde'],explicit:['dep:optional'],strong:['optional/serde']},{optional:{optional:true},implicit:{optional:true}});
 const defaults=resolver.resolve();assert(!defaults.dependencies.includes('optional'));assert(!defaults.available.includes('optional'));
 const explicit=resolver.resolve(['explicit']);assert(explicit.dependencies.includes('optional'));assert.deepEqual(explicit.dependencyFeatures.optional,['serde']);assert(!explicit.enabled.includes('optional'));
 assert(resolver.resolve(['implicit']).enabled.includes('implicit'));
 assert(resolver.resolve(['typo']).errors.length);assert(resolver.resolve(['optional']).errors.length);
 assert(new FeatureResolver({default:['undeclared']}).resolve().errors.length);
});
test('local feature unification reaches a fixed point across dependency diamonds',()=>{
 const files={
 'Cargo.toml':'[package]\nname="root"\nversion="0.1.0"\n[dependencies]\na={path="a"}\nb={path="b"}',
 'src/main.rs':'fn main(){println!("{} {}",a::value(),b::value());}',
 'a/Cargo.toml':'[package]\nname="a"\nversion="0.1.0"\n[dependencies]\nshared={path="../shared",default-features=false,features=["one"]}',
 'a/src/lib.rs':'pub fn value()->i32 {shared::value()}',
 'b/Cargo.toml':'[package]\nname="b"\nversion="0.1.0"\n[dependencies]\nshared={path="../shared",default-features=false,features=["two"]}',
 'b/src/lib.rs':'pub fn value()->i32 {shared::value()}',
 'shared/Cargo.toml':'[package]\nname="shared"\nversion="0.1.0"\n[features]\none=[]\ntwo=[]',
 'shared/src/lib.rs':'#[cfg(all(feature="one",feature="two"))] pub fn value()->i32 {7} #[cfg(not(all(feature="one",feature="two")))] pub fn value()->i32 {0}'};
 const plan=cargoPlan(files);assert.deepEqual(plan.errors,[]);assert.deepEqual(plan.features['shared/Cargo.toml'].enabled,['one','two']);
 assert.equal(output(new CompilerSession().compile(files)),'7 7\n');
});
test('optional local dependencies are compiled only when selected; required-features gates targets',()=>{
 const files={'Cargo.toml':manifest+'\n[[bin]]\nname="demo"\npath="src/main.rs"\nrequired-features=["fast"]','src/main.rs':'fn main(){}'};
 assert(cargoPlan(files).errors.some(e=>e.message.includes('requires features')));
 assert.deepEqual(cargoPlan(files,'run',{features:['fast']}).errors,[]);
 files['Cargo.toml']=manifest+'\n[dependencies]\nextra={path="missing",optional=true}\n';
 assert.deepEqual(cargoPlan(files).errors,[]);assert(cargoPlan(files,'run',{features:['extra']}).errors.some(e=>e.message.includes('missing')));
});

import {CargoOptions} from '../src/cargo/CargoOptions.js';
test('native argv preserves feature options and distinguishes library from binary targets',()=>{
 const options={package:'demo',target:'demo_lib',targetKind:'lib',features:['fast','fast'],defaultFeatures:false,allFeatures:true};
 assert.deepEqual(CargoOptions.arguments('check',options),['--package','demo','--lib','--all-features','--no-default-features','--features','fast']);
 assert.deepEqual(CargoOptions.arguments('fmt',options),['--package','demo']);
 assert.deepEqual(CargoOptions.arguments('clean',options),[]);
 assert.throws(()=>CargoOptions.arguments('run',{features:['bad feature']}),/Invalid Cargo feature/);
});
