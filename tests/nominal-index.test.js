import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse as parseTokens, tokenize, compile} from '../src/engine.js';
import {SymbolIndex} from '../src/compiler/SymbolIndex.js';
import {PatternCoverage} from '../src/compiler/patterns/PatternCoverage.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';

const parse = source => parseTokens(tokenize(source));
const run = build => new MirVirtualMachine(build.optimizedMir, {entry: build.entry}).run().output;
const project = () => ({
  'Cargo.toml': '[package]\nname="nominal_queries"\nversion="0.1.0"',
  'src/main.rs': 'mod data; fn main(){let data::P(x)=data::P(7);println!("{}",x);}',
  'src/data.rs': 'pub struct P(pub i32); pub fn value()->i32{1}',
});

test('declaration-local member index preserves object identity and first-match lookup semantics', () => {
  const index = new SymbolIndex(parse('struct P(i32);'));
  for (const width of [0, 1, 31, 32, 129, 1024]) {
    let visits = 0;
    const fields = Array.from({length: width}, (_, i) => ({name: String(i), type: 'i32'}));
    const owner = {fields: {[Symbol.iterator]: function* () { for (const field of fields) { visits++; yield field; } }}};
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i <= width; i++) {
      assert.equal(index.field(owner, String(i)), fields.find(field => field.name === String(i)));
    }
    assert.equal(visits, width, 'a declaration is scanned once, not once per projection');
  }
  const first = {name: 'x', type: 'i32'}, duplicate = {name: 'x', type: 'u8'};
  assert.equal(index.field({fields: [first, duplicate]}, 'x'), first);
  assert.equal(index.field(null, 'x'), undefined);
  assert.equal(index.variant(undefined, 'V'), undefined);
});

test('variant and tuple constructor indexes never alter AST or bypass visibility on cached hits', () => {
  const ast = parse('mod m{pub struct P(pub i32);struct Hidden;pub enum E{A(i32),B}}fn main(){}');
  const original = structuredClone(ast), index = new SymbolIndex(ast);
  const first = index.constructorFor('P', 'm'), next = index.constructorFor('m::P', '');
  assert.equal(first, next);
  assert(Object.isFrozen(first.variant.fields));
  const enumeration = index.enums.get('m::E');
  assert.equal(index.variant(enumeration, 'A'), enumeration.variants[0]);
  assert.equal(index.constructorFor('m::E::B', '').variant, enumeration.variants[1]);
  assert(index.constructorFor('Hidden', 'm'));
  assert.throws(() => index.constructorFor('m::Hidden', ''), error => error.code === 'E0603');
  assert.deepEqual(ast, original, 'no index Maps or canonical descriptors leak into syntax snapshots');
});

test('unchanged constructor bodies replay from immutable cache after unrelated edits', () => {
  const session = new CompilerSession(), files = project();
  const first = session.compile(files), before = JSON.stringify(first.hir);
  assert.equal(run(first), '7\n');
  files['src/data.rs'] = files['src/data.rs'].replace('{1}', '{2}');
  const second = session.compile(files);
  assert.equal(run(second), '7\n');
  assert.equal(second.queries.nodes.find(node => node.id === 'type:main<>').cacheHit, true);
  assert.equal(JSON.stringify(first.hir), before);
  assert.equal(run(session.compile(files)), '7\n');
});

test('constructor field type and visibility changes invalidate semantic indexes and queries', () => {
  const session = new CompilerSession(), files = project(); session.compile(files);
  files['src/data.rs'] = 'pub struct P(pub u8); pub fn value()->i32{1}';
  const resized = session.compile(files);
  assert.equal(run(resized), '7\n');
  assert.equal(resized.queries.nodes.find(node => node.id === 'type:main<>').cacheHit, false);
  files['src/data.rs'] = 'pub struct P(u8); pub fn value()->i32{1}';
  assert.throws(() => session.compile(files), error => error.code === 'E0616');
  files['src/data.rs'] = 'pub struct P(pub bool); pub fn value()->i32{1}';
  assert.throws(() => session.compile(files), error => error.code === 'E0308');
  files['src/data.rs'] = project()['src/data.rs'];
  assert.equal(run(session.compile(files)), '7\n');
});

test('constructor declaration form and arity cannot alias prior member tables', () => {
  const session = new CompilerSession(), files = project(); session.compile(files);
  for (const declaration of ['pub struct P;', 'pub struct P(pub i32,pub i32);', 'pub struct P{x:i32}']) {
    files['src/data.rs'] = declaration;
    assert.throws(() => session.compile(files), error => /^E\d+$/.test(error.code));
  }
  files['src/data.rs'] = project()['src/data.rs'];
  assert.equal(run(session.compile(files)), '7\n');
});

test('relocated constructor assignees retain new source spans and previous immutable MIR', () => {
  const session = new CompilerSession(), files = project();
  files['src/main.rs'] = 'mod data; fn main(){let mut x=0;data::P(x)=data::P(9);println!("{}",x);}';
  const first = session.compile(files), snapshot = JSON.stringify(first.mir);
  files['src/main.rs'] = '\n\n' + files['src/main.rs'];
  const second = session.compile(files);
  assert.equal(run(second), '9\n');
  assert.equal(second.mir.find(fn => fn.name === 'main').span.line, 3);
  assert.equal(second.queries.nodes.find(node => node.id === 'type:main<>').cacheHit, false);
  assert.equal(JSON.stringify(first.mir), snapshot);
});

test('cfg-filtered tuple fields and feature cache keys never share a stale ordinal table', () => {
  const session = new CompilerSession();
  const files = {'Cargo.toml': '[package]\nname="nominal_cfg"\nversion="0.1.0"\n[features]\nextra=[]',
    'src/main.rs': 'struct P(#[cfg(feature="extra")] bool,i32);#[cfg(feature="extra")]fn value()->i32{let P(_,x)=P(true,9);x}#[cfg(not(feature="extra"))]fn value()->i32{let P(x)=P(9);x}fn main(){println!("{}",value());}'};
  for (const features of [[], ['extra'], []]) assert.equal(run(session.compile(files, 'check', {features})), '9\n');
});

test('wide record construction, projection and ordered destructuring agree across indexed builds', () => {
  const width = 256, fields = Array.from({length:width}, (_, i) => `f${i}:i32`).join(',');
  const values = Array.from({length:width}, (_, i) => `f${i}:${i}`).reverse().join(',');
  const source = `struct Wide{${fields}}fn main(){let w=Wide{${values}};let Wide{f0:x,f255:y,..}=w;println!("{} {}",x,y);}`;
  assert.equal(run(compile(source)), '0 255\n');
});

test('coverage field indexes are renewed for each analysis of a modified pattern', () => {
  const index = new SymbolIndex(parse('struct P{v:bool}'));
  const coverage = new PatternCoverage(index);
  const pattern = {kind:'structPattern',name:'P',fields:[{name:'v',pattern:{kind:'literal',value:true}}]};
  const first = coverage.analyze([pattern], 'P');
  assert.equal(first.exhaustive, false);
  pattern.fields[0].pattern = {kind:'wildcard'};
  assert.equal(coverage.analyze([pattern], 'P').exhaustive, true);
});
