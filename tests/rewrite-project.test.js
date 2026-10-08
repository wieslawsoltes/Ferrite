import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileProject, CompilerSession} from '../src/project.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {VirtualFileSystem as V} from '../src/project/VirtualFileSystem.js';
import {SourceFile} from '../src/project/SourceFile.js';
import {cargoPlan, mergeCrateSources, parseManifest} from '../src/cargo.js';
const manifest = '[package]\nname="app"\nversion="0.1.0"\nedition="2021"\n';
const execute = c => new MirVirtualMachine(c.optimizedMir, {entry: c.entry}).run().output;

test('file-aware namespaces, imports, nested modules and diagnostics', () => {
  const files = {'Cargo.toml': manifest, 'src/main.rs': 'mod math; use math::twice; fn main(){println!("{}",twice(4));}',
    'src/math.rs': 'mod detail; pub fn twice(x:i32)->i32{detail::add(x,x)}', 'src/math/detail.rs':'pub fn add(a:i32,b:i32)->i32{a+b}'};
  const c = compileProject(files); assert.equal(execute(c), '8\n');
  assert(c.sem.instances.some(i => i.key === 'math::detail::add<>' && i.span.file === 'src/math/detail.rs'));
  assert(c.generatedMap.some(m => m.span.file === 'src/math/detail.rs'));
  assert.throws(() => compileProject({...files, 'src/math/detail.rs':'pub fn add(a:i32,b:i32)->i32{false}'}), e => e.code === 'E0308' && e.span.file === 'src/math/detail.rs');
});
test('private child functions are not callable from their parent', () => {
  assert.throws(() => compileProject({'Cargo.toml':manifest, 'src/main.rs':'mod a;fn main(){a::hidden();}', 'src/a.rs':'fn hidden(){}'}), e => e.code === 'E0603');
});
test('module-looking comments and strings are never loaded', () => {
  const files = {'src/main.rs':'// mod ghost;\nfn main(){println!("mod ghost;");}'};
  assert.deepEqual(mergeCrateSources(files).modules, ['src/main.rs']);
  assert.equal(execute(compileProject({'Cargo.toml':manifest,...files})), 'mod ghost;\n');
});
test('local Cargo dependencies resolve crate-relative paths', () => {
  const c = compileProject({'Cargo.toml':manifest+'[dependencies]\nmath={path="crates/math"}\n',
    'src/main.rs':'fn main(){println!("{}",math::answer());}', 'crates/math/Cargo.toml':'[package]\nname="math"',
    'crates/math/src/lib.rs':'mod detail; pub fn answer()->i32{detail::call()} pub fn value()->i32{42}',
    'crates/math/src/detail.rs':'pub fn call()->i32{crate::value()}'});
  assert.equal(execute(c), '42\n'); assert.equal(c.plan.buildOrder[0], 'crates/math/Cargo.toml');
});
test('local Cargo workspace selects a member and explicit binary', () => {
  const f = {'Cargo.toml':'[workspace]\nmembers=["apps/*"]', 'apps/demo/Cargo.toml':manifest+'[[bin]]\nname="alternate"\npath="demo.rs"', 'apps/demo/demo.rs':'fn main(){println!("member");}'};
  assert.equal(execute(compileProject(f, 'run', {package:'app',target:'alternate'})), 'member\n');
});
test('library crates have no fabricated entry point', () => {
  const c = compileProject({'Cargo.toml':manifest, 'src/lib.rs':'pub fn square(x:i32)->i32{x*x}'});
  assert.equal(c.entry, undefined); assert(!c.js.endsWith('f0();')); assert.equal(c.sem.instances[0].key, 'square<>');
});
test('test discovery does not execute main and exposes independent test entries', () => {
  const c = compileProject({'Cargo.toml':manifest,'src/main.rs':'fn main(){panic!("must not run");} #[test] fn first(){assert_eq!(4,2+2);} #[test] #[ignore] fn ignored(){panic!("skip");}'}, 'test');
  assert.equal(c.tests.length,2); assert.equal(c.tests[1].ignore,true);
  assert.equal(new MirVirtualMachine(c.optimizedMir,{entry:c.tests[0].instance}).run().done,true);
});
test('syntax caches reuse unchanged files and source identity cannot alias different projects', () => {
  const session = new CompilerSession(), files = {'Cargo.toml':manifest,'src/main.rs':'mod a;fn main(){a::f();}','src/a.rs':'pub fn f(){println!("ok");}'};
  const a = session.compile(files); assert.equal(a.cache.parsedFiles,2);
  const b = session.compile(files); assert(b.cacheHit); assert.equal(b.timings.length,0);
  const c = session.compile({...files,'src/main.rs':files['src/main.rs']+'\n'}); assert.equal(c.cache.parsedFiles,1); assert.equal(c.cache.reusedFiles,1);
  assert(Object.isFrozen(c.ast));
});
test('TOML multiline arrays, literal/quoted keys, array tables and comments', () => {
  const m = parseManifest('[package]\nname="demo#not-comment" # comment\n[dependencies]\n"some-crate"={version="1", features=[\n"a", # comment\n"b",\n]}\n[[bin]]\nname=\'one\'\npath="src/one.rs"\n[[bin]]\nname="two"\npath="src/two.rs"');
  assert.equal(m.errors.length,0); assert.equal(m.package.name,'demo#not-comment');
  assert.deepEqual(m.dependencies['some-crate'].features,['a','b']); assert.equal(m.sections.bin.length,2);
});
test('malformed TOML becomes a diagnostic instead of a prototype mutation', () => {
  assert(parseManifest('[__proto__]\nx=1').errors.length); assert(parseManifest('name={value=1}\n[name.value]\nx=2').errors.length);
  assert.equal({}.x,undefined);
});
test('source positions round-trip Unicode and file boundaries', () => {
  const f = new SourceFile('src/unicode.rs','α\n🦀text\n');
  for(let i=0;i<=f.text.length;i++){const p=f.position(i);assert.equal(f.offset(p.line,p.column),i);}
});
test('filesystem rejects traversal, normalized aliases and non-text contents', () => {
  assert.throws(()=>V.validate({'../file':'x'})); assert.throws(()=>V.validate({'src/a':'x','src/./a':'y'}));
  assert.throws(()=>V.validate({'src/main.rs':5})); assert.throws(()=>V.validate(JSON.parse('{"__proto__":"x"}')));
});
test('build scripts are explicitly delegated to native Cargo', () => {
  const f={'Cargo.toml':manifest,'src/main.rs':'fn main(){}','build.rs':'fn main(){}'};
  assert(cargoPlan(f).nativeRequired.length); assert.throws(()=>compileProject(f), /build script requires native Cargo/);
});
