import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile, parse, tokenize} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {matchErgonomicsCases,matchErgonomicsCompileFailCases,matchErgonomicsCapabilityCases,matchErgonomicsGuide} from './fixtures/match-ergonomics.js';
const output = artifact => new MirVirtualMachine(JSON.parse(JSON.stringify(artifact.optimizedMir)), {entry: artifact.entry}).run().output;
for (const [name, source, expected] of matchErgonomicsCases) test(`reference match: ${name}`, () => {
  for (const optimize of [false, true]) {
    const artifact = compile(source, {optimize});
    assert.equal(output(artifact), expected);
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output, expected);
    const context = vm.createContext({}); vm.runInContext(artifact.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), expected);
  }
});
for (const [name, source, code] of matchErgonomicsCompileFailCases) test(`reference match rejects: ${name}`, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, error.stack); assert.ok(error.span?.end > error.span?.start); return true;
  });
});

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const walk = function* (value) {
  if (!value || typeof value !== 'object') return;
  yield value;
  for (const child of Object.values(value)) yield* walk(child);
};

test('reference-aware matching leaves frozen lexer streams and source ASTs unchanged', () => {
  for (const [accepted, cases] of [[true, matchErgonomicsCases], [false, matchErgonomicsCompileFailCases]]) {
    for (const [, source, expected] of cases) {
      const tokens = freeze(tokenize(source)), lexer = JSON.stringify(tokens);
      let ast;
      try { ast = freeze(parse(tokens)); }
      catch (error) {
        assert.equal(accepted, false); assert.equal(error.code, expected);
        assert.equal(JSON.stringify(tokens), lexer); continue;
      }
      const syntax = JSON.stringify(ast);
      assert.equal(JSON.stringify(tokens), lexer);
      if (accepted) assert.equal(output(compile('', {ast})), expected);
      else assert.throws(() => compile('', {ast}), {code: expected});
      assert.equal(JSON.stringify(ast), syntax);
      assert.equal(JSON.stringify(tokens), lexer);
    }
  }
});

import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {PatternAnalyzer} from '../src/compiler/patterns/PatternAnalyzer.js';
import {PatternOwnership} from '../src/compiler/ownership/PatternOwnership.js';

test('reference-aware matching replays actual semantic queries and invalidates conflicting edits', () => {
  const cache = new SemanticQueryCache();
  const source = 'fn main(){let mut p=(40,2);let r=&mut p;let(x,_)=r;*x+=2;println!("{}",p.0);}';
  let baseline;
  for (let i=0;i<3;i++) {
    cache.beginBuild(); const artifact = compile(source,{queryCache:cache});
    assert.equal(output(artifact),'42\n');
    const report = artifact.ownership.find(item => item.instance === 'main<>');
    assert.ok(report.patternWork > 0);
    const events = report.events.filter(e => e.kind?.endsWith('pattern loan') || e.action?.endsWith('pattern loan'));
    assert.ok(events.some(e => report.places[e.place].name === 'p.0'));
    if (baseline) {
      assert.deepEqual(artifact.ownership,baseline);
      for (const stage of ['type','ownership','mir']) assert.ok(artifact.queries.nodes.some(n => n.stage===stage && n.cacheHit));
    } else baseline = structuredClone(artifact.ownership);
    cache.beginBuild(); assert.throws(() => compile(source.replace('*x+=2;','r.0=1;*x+=2;'),{queryCache:cache}), {code:'E0502'});
  }
});

for (const [owner,key,value] of [[PatternAnalyzer,'MAX_SOURCE_DEPTH',1],[PatternOwnership,'MAX_DEPTH',1],[PatternOwnership,'MAX_NODES',1]]) {
  test(`reference-aware matching ${owner.name}.${key} fails and recovers atomically`, () => {
    const old = owner[key],cache=new SemanticQueryCache();
    const source='fn main(){let p=(40,2);let(x,y)=&p;println!("{}",*x+*y);}';
    try { owner[key]=value;assert.throws(()=>compile(source,{queryCache:cache}),{code:'F_OWNERSHIP_LIMIT'}); }
    finally {owner[key]=old;}
    cache.beginBuild(); assert.equal(output(compile(source,{queryCache:cache})),'42\n');
  });
}

test('injected reference patterns cannot request implicit mode or forge address authority', () => {
  const ast = parse(tokenize('fn main(){let p=(1,);let (ref x,)=&p;}'));
  for (const node of walk(ast)) if (node.kind === 'bindingPattern') {
    node.implicit=true;node.automatic=true;node.patternWrittenMode='value';
  }
  assert.throws(()=>compile('',{ast:freeze(ast)}),{code:'E0003'});
  const forged = parse(tokenize('fn main(){let p=(40,2);let(x,y)=&p;println!("{}",*x+*y);}'));
  for (const node of [...walk(forged)]) if(node.kind==='let') {
    node.value.patternStorage={slot:999_999,name:'forged',mutable:true,type:'i32'};
    node.value.patternBorrowed=true;
  }
  assert.equal(output(compile('',{ast:freeze(forged)})),'42\n');
});

for (const invalid of ['yes', 1, null]) test(`malformed reference pattern mutability ${JSON.stringify(invalid)} is rejected`, () => {
  const ast=parse(tokenize('fn main(){let n=42;let &x=&n;}'));
  for(const node of walk(ast)) if(node.kind==='referencePattern') node.mutable=invalid;
  assert.throws(()=>compile('',{ast:freeze(ast)}),{code:'F_PATTERN'});
});

test('a reference-pattern child must be a valid pattern', () => {
  for(const child of [null,42,{kind:'bogus',span:{start:0,end:1}}]) {
    const ast=parse(tokenize('fn main(){let n=42;let &x=&n;}'));
    for(const node of [...walk(ast)]) if(node.kind==='referencePattern') node.pattern=child;
    assert.throws(()=>compile('',{ast:freeze(ast)}),error=>/^F_PATTERN|^E0003/.test(error.code));
  }
});

test('reference-prefix nesting reports a bounded diagnostic, not a host stack overflow', () => {
  assert.throws(()=>parse(tokenize(`fn main(){let ${'&'.repeat(300)}x=1;}`)),{code:'F0102'});
});

// These are native-valid programs, not compile-fail conformance fixtures.
for(const [name,source,code] of matchErgonomicsCapabilityCases) test(`reference matching capability boundary: ${name}`,()=>{
  assert.throws(()=>compile(source),{code});
});

test('match-ergonomics documentation, example and native fixture stay identical', () => {
  const source=readFileSync(new URL('../examples/13-match-ergonomics.rs',import.meta.url),'utf8');
  const doc=readFileSync(new URL('../docs/match-ergonomics.md',import.meta.url),'utf8');
  assert.equal(source,matchErgonomicsGuide);
  assert.equal(doc.match(/```rust\n([\s\S]*?)```/)[1],source);
});
