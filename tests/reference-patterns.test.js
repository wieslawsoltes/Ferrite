import {readFileSync} from 'node:fs';
import {referencePatternGuide} from './fixtures/reference-patterns.js';
import {PatternAnalyzer} from '../src/compiler/patterns/PatternAnalyzer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile, parse, tokenize} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {Runtime} from '../src/runtime/Runtime.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {PatternOwnership} from '../src/compiler/ownership/PatternOwnership.js';
import {referencePatternCases, referencePatternCompileFailCases} from './fixtures/reference-patterns.js';
const output = artifact => new MirVirtualMachine(JSON.parse(JSON.stringify(artifact.optimizedMir)), {entry: artifact.entry}).run().output;
for (const [name, source, expected] of referencePatternCases) test(`reference pattern: ${name}`, () => {
  for (const optimize of [false, true]) {
    const artifact = compile(source, {optimize});
    assert.equal(output(artifact), expected);
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output, expected);
    const context = vm.createContext({}); vm.runInContext(artifact.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), expected);
  }
});
for (const [name, source, code] of referencePatternCompileFailCases) test(`reference pattern rejects: ${name}`, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, error.stack); assert.ok(error.span?.end > error.span?.start); return true;
  });
});
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
test('reference patterns preserve immutable accepted and rejected ASTs', () => {
  for (const [accepted, cases] of [[true, referencePatternCases], [false, referencePatternCompileFailCases]])
    for (const [, source, expected] of cases) {
      const ast = freeze(parse(tokenize(source))), original = JSON.stringify(ast);
      if (accepted) assert.equal(output(compile('', {ast})), expected);
      else assert.throws(() => compile('', {ast}), {code: expected});
      assert.equal(JSON.stringify(ast), original);
    }
});
test('pattern loan reports are source-linked and replay through real semantic queries', () => {
  const cache = new SemanticQueryCache();
  const source = 'fn main(){let mut p=(40,2);let (ref mut x,ref y)=p;*x+=*y;println!("{}",p.0);}';
  let baseline;
  for (let i = 0; i < 3; i++) {
    cache.beginBuild(); const artifact = compile(source, {queryCache: cache});
    assert.equal(output(artifact), '42\n');
    const report = artifact.ownership.find(item => item.instance === 'main<>');
    assert.deepEqual(report.events.filter(e => e.kind?.endsWith('pattern loan') || e.action?.endsWith('pattern loan')).map(e => report.places[e.place].name).sort(), ['p.0','p.1']);
    if (baseline) {
      assert.deepEqual(artifact.ownership, baseline);
      for (const stage of ['type', 'ownership', 'mir']) assert.ok(artifact.queries.nodes.some(n => n.stage === stage && n.cacheHit));
    } else baseline = structuredClone(artifact.ownership);
    cache.beginBuild(); assert.throws(() => compile(source.replace('*x+=*y;', 'p.0=1;*x+=*y;'), {queryCache: cache}), {code: 'E0502'});
  }
});
for (const [key, limit] of [['MAX_NODES',0], ['MAX_DEPTH',0]]) test(`reference pattern ${key} failure recovers atomically`, () => {
  const previous = PatternOwnership[key], cache = new SemanticQueryCache(), [, source, expected] = referencePatternCases[4];
  try { PatternOwnership[key] = limit; assert.throws(() => compile(source, {queryCache: cache}), {code: 'F_OWNERSHIP_LIMIT'}); }
  finally { PatternOwnership[key] = previous; }
  cache.beginBuild(); assert.equal(output(compile(source, {queryCache: cache})), expected);
});
test('malformed injected reference-binding mode is rejected', () => {
  const ast = parse(tokenize('fn main(){let p=42;let ref x=p;println!("{}",*x);}'));
  const stack = [ast];
  while (stack.length) { const node = stack.pop(); if (!node || typeof node !== 'object') continue;
    if (node.byRef) node.byRef = 'mutable'; else stack.push(...Object.values(node)); }
  assert.throws(() => compile('', {ast: freeze(ast)}), {code: 'F_PATTERN'});
});
test('enum payload places are schema-checked before MIR execution', () => {
  const artifact = compile('fn main(){let mut p=Some(40);if let Some(ref mut x)=p{*x+=2;}println!("{}",p.unwrap());}');
  for (const invalid of [{kind:'payload',variant:'Some',index:0}, {kind:'payload',variant:'Option::Some',index:-1}, {kind:'payload',variant:'Option::Some',index:0.5}, {kind:'unknown'}]) {
    const mir = structuredClone(artifact.optimizedMir);
    const borrow = mir.flatMap(f => f.blocks.flatMap(b => b.instructions)).find(i => i.op === 'borrow' && i.place.path.some(p => p.kind === 'payload'));
    assert.ok(borrow); borrow.place.path[0] = invalid;
    assert.throws(() => MirVerifier.verify(mir), {code:'F_MIR'});
  }
  const runtime = new Runtime(), cells = runtime.cells(1);
  cells[0].value = {tag:'Option::None',values:[]};
  assert.throws(() => runtime.borrow(runtime.reference(cells,0,[{kind:'payload',variant:'Option::Some',index:0}])), {code:'R_REFERENCE'});
});
// Native-valid capabilities not represented by this increment are not added to
// the Rust compile-fail oracle corpus.
for (const [name, source] of [
  ['borrowed array rest', 'fn main(){let a=[1,2,3];let [_,ref r @ ..]=a;println!("{}",r[0]);}'],
  ['correlated exclusive alternatives', 'fn main(){let mut p=(1,2);match p{(ref mut x,ref mut y)|(ref mut y,ref mut x)=>{*x+=1;*y+=1;}}}'],
  ['for-loop yielded storage', 'fn main(){for ref x in [1,2]{println!("{}",*x);}}'],
]) test(`explicit reference-pattern capability boundary: ${name}`, () => {
  assert.throws(() => compile(source), {code:'F_PATTERN_BORROW'});
});

test('new reference-pattern paths do not discard hidden aggregate loans', () => {
  for (const source of [
    'fn main(){let mut n=1;let ref r=(&n,);n=2;println!("{}",*r.0);}',
    'fn main(){let mut n=1;let p=(&n,);let (ref r,)=p;n=2;println!("{}",**r);}',
    'fn main(){let mut n=1;let p=(&n,);let ref r=p.0;n=2;println!("{}",**r);}',
  ]) assert.throws(() => compile(source), {code:'F_PATTERN_BORROW'});
});

test('reference-storage mutation requires assignment-aware inner regions', () => {
  assert.throws(() => compile('fn main(){let a=1;let b=2;let mut r=&a;let ref mut rr=r;*rr=&b;println!("{}",**rr);}'), {code:'F_PATTERN_BORROW'});
  assert.throws(() => compile('fn main(){let a=1;let mut r=&a;let ref mut rr=r;{let b=2;*rr=&b;}println!("{}",**rr);}'), {code:'F_PATTERN_BORROW'});
});

test('injected ASTs cannot forge compiler-owned source-address storage', () => {
  const source = 'fn main(){let mut n=40;let ref mut x=n;*x+=2;println!("{}",n);}';
  const ast = parse(tokenize(source));
  const pending = [ast];
  while (pending.length) {
    const node = pending.pop(); if (!node || typeof node !== 'object') continue;
    if (node.kind === 'let') {
      node.value.patternStorage = {slot: 999_999, name:'forged', mutable:true, type:'i32'};
      node.value.patternBorrowed = true;
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'patternStorage') pending.push(value);
  }
  assert.equal(output(compile('', {ast: freeze(ast)})), '42\n');
});

test('mutable-reference bindings reject malformed mutability metadata', () => {
  const ast = parse(tokenize('fn main(){let mut x=1;let ref mut r=x;*r=2;}'));
  const pending = [ast];
  while (pending.length) {
    const node = pending.pop(); if (!node || typeof node !== 'object') continue;
    if (node.byRef) node.mutable = 'yes'; else pending.push(...Object.values(node));
  }
  assert.throws(() => compile('', {ast: freeze(ast)}), {code:'F_PATTERN'});
});

test('reference source-address budget failure recovers through cached compilation', () => {
  const previous = PatternAnalyzer.MAX_SOURCE_DEPTH, cache = new SemanticQueryCache();
  const source = 'fn main(){let x=42;let ref r=x;println!("{}",*r);}';
  try { PatternAnalyzer.MAX_SOURCE_DEPTH=0; assert.throws(() => compile(source,{queryCache:cache}), {code:'F_OWNERSHIP_LIMIT'}); }
  finally { PatternAnalyzer.MAX_SOURCE_DEPTH=previous; }
  cache.beginBuild(); assert.equal(output(compile(source,{queryCache:cache})), '42\n');
});

test('constant-promotion difference is a native-valid capability boundary', () => {
  assert.throws(() => compile('fn main(){let r=match (1,2){(ref x,_)=>x};println!("{}",*r);}'), {code:'E0597'});
});

test('reference-pattern documentation, example and native fixture stay identical', () => {
  const source = readFileSync(new URL('../examples/12-reference-patterns.rs',import.meta.url),'utf8');
  const doc = readFileSync(new URL('../docs/reference-patterns.md',import.meta.url),'utf8');
  assert.equal(source, referencePatternGuide);
  assert.equal(doc.match(/```rust\n([\s\S]*?)```/)[1],source);
});
