import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {letChainCases, letChainCompileFailCases, letChainPanicCases} from './fixtures/let-chains.js';
import {Lexer} from '../src/compiler/Lexer.js';
import {Parser} from '../src/compiler/Parser.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {ConditionChain} from '../src/compiler/conditions/ConditionChain.js';
import {ConditionOwnership} from '../src/compiler/conditions/ConditionOwnership.js';

for (const [name, source, output] of letChainCases) test(name, () => {
  for (const optimize of [false, true]) {
    const c = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(JSON.parse(JSON.stringify(c.optimizedMir)), {entry: c.entry}).run().output, output);
    assert.equal(new WebAssemblyRuntime(c.wasm).run().output, output);
    const context = vm.createContext({});
    vm.runInContext(c.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), output);
  }
});
for (const [name, source, code] of letChainCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, error.stack);
    assert.ok(error.span && error.span.start >= 0, 'source-linked diagnostic');
    return true;
  });
});
for (const [name, source, code, output] of letChainPanicCases) test(name, () => {
  for (const optimize of [false, true]) {
    const c = compile(source, {optimize});
    const machine = new MirVirtualMachine(JSON.parse(JSON.stringify(c.optimizedMir)), {entry: c.entry});
    const wasm = new WebAssemblyRuntime(c.wasm), context = vm.createContext({});
    for (const [run, read] of [[() => machine.run(), () => machine.runtime.output],
      [() => wasm.run(), () => wasm.runtime.output],
      [() => vm.runInContext(c.js, context, {timeout: 3000}), () => vm.runInContext('r.output', context)]]) {
      assert.throws(run, e => e.code === code);
      assert.equal(read(), output);
    }
  }
});



const parse = source => Parser.parse(Lexer.tokenize(source));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const execute = result => new MirVirtualMachine(JSON.parse(JSON.stringify(result.optimizedMir)), {entry: result.entry}).run().output;

test('let-chain parser preserves single-pattern and ordinary-boolean ASTs', () => {
  for (const [source, kind] of [
    ['fn main(){if let x=1{}}', 'ifLet'], ['fn main(){while let x=1{}}', 'whileLet'],
    ['fn main(){if true||false&&true{}}', 'ifExpr'], ['fn main(){while true&&false{}}', 'while'],
    ['fn main(){if true && let x=1{}}', 'ifChain'], ['fn main(){while let x=1 && true{}}', 'whileChain'],
  ]) {
    const body = parse(source).items[0].body;
    const statement = body.body[0];
    const node = body.tail ?? (statement?.kind === 'expression' ? statement.value : statement);
    assert.equal(node.kind, kind);
  }
});

test('let chains preserve every accepted source AST, even when deeply frozen', () => {
  for (const [, source, output] of letChainCases) {
    const ast = freeze(parse(source)), before = JSON.stringify(ast);
    for (const optimize of [false, true]) assert.equal(execute(compile('', {ast, optimize})), output);
    assert.equal(JSON.stringify(ast), before);
  }
});

test('let-chain failures preserve frozen source ASTs', () => {
  const cache = new SemanticQueryCache();
  for (const [, source, code] of letChainCompileFailCases) {
    const ast = freeze(parseSourceOrReturn(source)), before = JSON.stringify(ast);
    if (!ast) continue; // Syntax failures have no source AST to inject.
    cache.beginBuild();
    assert.throws(() => compile('', {ast, queryCache: cache}), {code});
    assert.equal(JSON.stringify(ast), before);
    assert.ok(cache.characters <= cache.maxCharacters);
  }
  function parseSourceOrReturn(source) { try { return parse(source); } catch { return null; } }
});

test('let-chain query replay preserves scopes, ownership and concrete control flow', () => {
  const cache = new SemanticQueryCache();
  const good = 'fn main(){let s=String::from("x");if let t=s && true{println!("{}",t);}}';
  const bad = 'fn main(){let s=String::from("x");if let t=s && true{}println!("{}",s);}';
  for (let i = 0; i < 3; i++) {
    cache.beginBuild(); const c = compile(good, {queryCache: cache}); assert.equal(execute(c), 'x\n');
    if (i) for (const stage of ['type', 'ownership', 'mir'])
      assert.ok(c.queries.nodes.some(node => node.stage === stage && node.cacheHit), stage);
    cache.beginBuild(); assert.throws(() => compile(bad, {queryCache: cache}), {code: 'E0382'});
  }
});

test('let-chain lowering emits a single failure arm with linear control-flow growth', () => {
  for (const count of [8, 32, 128, 256]) {
    const condition = Array.from({length: count}, (_, i) => `let x${i}=${i}`).join(' && ');
    const c = compile(`fn main(){if ${condition}{println!("yes");}else{println!("no");}}`, {optimize: false});
    assert.equal(execute(c), 'yes\n');
    const fn = c.mir.find(fn => fn.key === c.entry) ?? c.mir[0];
    assert.equal(fn.blocks.filter(block => block.label === 'let-chain failure').length, 1);
    assert.ok(fn.blocks.length <= count + 4);
    assert.equal(fn.blocks.flatMap(block => block.instructions).filter(i => i.op === 'builtin' && i.name === 'println').length, 2);
    assert.ok(c.ownership[0].conditions.work < count * 8 + 50);
  }
});

test('let-chain parser and injected AST independently enforce the operand budget', () => {
  const source = `fn main(){if ${Array.from({length: 257}, (_, i) => `let x${i}=1`).join(' && ')}{}}`;
  assert.throws(() => compile(source), {code: 'F_CONDITION_LIMIT'});
  const ast = parse('fn main(){if let x=1 && true{}}');
  const chain = ast.items[0].body.tail;
  chain.conditions = Array.from({length: 257}, () => structuredClone(chain.conditions[0]));
  assert.throws(() => compile('', {ast}), {code: 'F_CONDITION_LIMIT'});
});

test('let-chain ownership budget failure is atomic and recovery rechecks the body', () => {
  const source = 'fn main(){let mut n=0;while n<2 && let x=n{n=x+1;}println!("{}",n);}';
  const cache = new SemanticQueryCache(), old = ConditionOwnership.MAX_WORK;
  try {
    ConditionOwnership.MAX_WORK = 1;
    assert.throws(() => compile(source, {queryCache: cache}), {code: 'F_CONDITION_LIMIT'});
  } finally { ConditionOwnership.MAX_WORK = old; }
  cache.beginBuild(); const c = compile(source, {queryCache: cache}); assert.equal(execute(c), '2\n');
  assert.ok(c.queries.nodes.some(node => node.stage === 'ownership' && !node.cacheHit));
  assert.ok(c.ownership[0].conditions.work > 1);
});

test('let-chain loop analysis reaches a moved-state fixed point instead of trusting one iteration', () => {
  const c = compile('fn main(){let mut s=String::from("x");let mut n=0;while n<2 && let t={s=String::from("y");s}{n+=1;println!("{}",t);}}');
  assert.equal(execute(c), 'y\ny\n');
  assert.ok(c.ownership[0].conditions.loopIterations >= 2);
  assert.ok(c.ownership[0].conditions.loopIterations < ConditionOwnership.MAX_ITERATIONS);
  const old = ConditionOwnership.MAX_ITERATIONS;
  try {
    ConditionOwnership.MAX_ITERATIONS = 1;
    assert.throws(() => compile('fn main(){let mut s=String::from("x");while true && let t={s=String::from("y");s}{}}'), {code: 'F_CONDITION_LIMIT'});
  } finally { ConditionOwnership.MAX_ITERATIONS = old; }
});

test('let-chain explicit reference-origin boundaries reject rather than emit untracked loans', () => {
  // These first three sources are valid native Rust. They are capability-boundary
  // tests, intentionally not misrepresented as native compile-fail fixtures.
  for (const source of [
    'fn main(){let n=7;if let x=(&n,8) && true{println!("{}",*x.0);}}',
    'fn same(n:&i32)->&i32{n}fn main(){let n=7;if let r=same(&n) && true{println!("{}",*r);}}',
    'fn main(){let n=7;let r=if let x=7 && true{(&n,x)}else{(&n,0)};println!("{}",*r.0);}',
    // Native rejects this invalid escape; Ferrite lacks interprocedural return
    // origins and must also fail, never silently accept an empty root set.
    'fn same(n:&i32)->&i32{n}fn f(p:&i32)->&i32{if let n=7 && true{same(&n)}else{p}}fn main(){}',
  ]) assert.throws(() => compile(source), {code: 'F_CONDITION_REFERENCE'});
});

test('let-chain deferred integer inference remains an explicit existing boundary', () => {
  // Native infers usize from the later array count. Ferrite's eager local type
  // inference needs a suffix here; do not call this a native rejection fixture.
  assert.throws(() => compile('fn main(){let a=[7;const{if let n=3 && n>0{n}else{0}}];}'), {code: 'E0308'});
});

test('let-chain nested ownership budget is restored after failure', () => {
  const source = 'fn main(){if let x=1 && (if let y=2 && y>x{true}else{false}){println!("ok");}}';
  const old = ConditionOwnership.MAX_DEPTH;
  try {
    ConditionOwnership.MAX_DEPTH = 1;
    assert.throws(() => compile(source), {code: 'F_CONDITION_LIMIT'});
  } finally { ConditionOwnership.MAX_DEPTH = old; }
  assert.equal(execute(compile(source)), 'ok\n');
});

test('let-chain injected malformed conditions never reach ordinary MIR', () => {
  for (const change of [
    chain => { chain.conditions = []; },
    chain => { chain.conditions[0].parenthesized = true; },
    chain => { delete chain.conditions[0].pattern; },
    chain => { chain.conditions[1] = {kind: 'binary', op: '||', span: chain.span}; },
  ]) {
    const ast = parse('fn main(){if let x=1 && true{}}');
    change(ast.items[0].body.tail);
    assert.throws(() => compile('', {ast}), {code: 'E0003'});
  }
});

test('let-chain guide example is the actual differential source fixture', () => {
  const guide = readFileSync(new URL('../docs/let-chains.md', import.meta.url), 'utf8');
  const source = guide.match(/```rust\n([\s\S]*?)```/)[1];
  const fixture = letChainCases.find(([name]) => name === 'let chain: documented complete program');
  assert.equal(source, fixture[1]);
  assert.equal(execute(compile(source)), fixture[2]);
});
