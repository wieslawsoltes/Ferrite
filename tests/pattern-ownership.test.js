import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {compile, parse, tokenize} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {PatternOwnership} from '../src/compiler/ownership/PatternOwnership.js';
import {patternOwnershipCases, patternOwnershipCompileFailCases, patternOwnershipGuide} from './fixtures/pattern-ownership.js';
const output = artifact => new MirVirtualMachine(JSON.parse(JSON.stringify(artifact.optimizedMir)), {entry:artifact.entry}).run().output;
for (const [name, source, expected] of patternOwnershipCases) test(`pattern ownership: ${name}`, () => {
  for (const optimize of [false, true]) {
    const artifact = compile(source, {optimize});
    assert.equal(output(artifact), expected);
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output, expected);
    const context = vm.createContext({}); vm.runInContext(artifact.js, context, {timeout:3000});
    assert.equal(vm.runInContext('r.output', context), expected);
  }
});
for (const [name, source, code] of patternOwnershipCompileFailCases) test(`pattern ownership rejects: ${name}`, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, error.stack); assert.ok(error.span?.end > error.span?.start); return true;
  });
});
const freeze = value => { if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}return value; };
test('pattern plans preserve frozen source trees', () => {
  for (const [valid, cases] of [[true, patternOwnershipCases], [false, patternOwnershipCompileFailCases]])
    for (const [, source, expected] of cases) {
      const ast = freeze(parse(tokenize(source))), before = JSON.stringify(ast);
      if (valid) assert.equal(output(compile('', {ast})), expected);
      else assert.throws(() => compile('', {ast}), {code:expected});
      assert.equal(JSON.stringify(ast), before);
    }
});
test('projected moves are source linked and independently replayed from real semantic queries', () => {
  const cache = new SemanticQueryCache(), source = patternOwnershipCases[0][1]; let baseline;
  for (let i = 0; i < 3; i++) {
    cache.beginBuild(); const artifact = compile(source, {queryCache:cache});
    assert.equal(output(artifact), 'left right\n');
    if (baseline) {
      assert.deepEqual(artifact.ownership, baseline);
      for (const stage of ['type','ownership','mir']) assert.ok(artifact.queries.nodes.some(node => node.stage===stage && node.cacheHit));
    } else baseline = structuredClone(artifact.ownership);
    const report = artifact.ownership.find(item => item.instance === 'main<>');
    assert.deepEqual(report.events.filter(event => event.detail === 'pattern binding').map(event => report.places[event.place].name), ['p.0','p.1']);
    assert.ok(report.patternWork > 0); assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
    cache.beginBuild(); assert.throws(() => compile(source.replace('(_,b)=p', '(b,_)=p'), {queryCache:cache}), {code:'E0382'});
  }
});
for (const [key, limit] of [['MAX_NODES',0],['MAX_DEPTH',0]]) test(`pattern ${key} failure is atomic and recovers`, () => {
  const before = PatternOwnership[key], cache = new SemanticQueryCache(), source = patternOwnershipCases[0][1];
  try { PatternOwnership[key]=limit; assert.throws(() => compile(source, {queryCache:cache}), {code:'F_OWNERSHIP_LIMIT'}); }
  finally { PatternOwnership[key]=before; }
  cache.beginBuild(); assert.equal(output(compile(source, {queryCache:cache})), 'left right\n');
});
test('untracked aggregate reference origins fail as a separate capability boundary', () => {
  const source = 'fn main(){let x=42;let (r,)=(&x,);println!("{}",*r);}';
  assert.throws(() => compile(source), {code:'F_PATTERN_REFERENCE'});
});

test('pattern ownership guide, example and differential source cannot drift', () => {
  const source = readFileSync(new URL('../examples/11-pattern-ownership.rs', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../docs/pattern-ownership.md', import.meta.url), 'utf8');
  assert.equal(source, patternOwnershipGuide); assert.equal(guide.match(/```rust\n([\s\S]*?)```/)[1], source);
});
