import test from 'node:test';
import assert from 'node:assert/strict';
import {TraitHierarchy} from '../src/compiler/TraitHierarchy.js';
import {compile} from '../src/engine.js';
import {CompilerCache} from '../src/compiler/CompilerCache.js';

function index(graph) {
  const traits = new Map(Object.entries(graph).map(([name, bounds]) => [name, Object.freeze({name, module: '', bounds: Object.freeze(bounds), predicates: []})]));
  return {traits, typeResolver: {find: (table, name) => table.get(name)}, type: raw => raw};
}
function oracle(graph, name) {
  const result = [], visited = new Set();
  const walk = value => {if (visited.has(value)) return; visited.add(value); result.push(value); (graph[value] ?? []).forEach(walk);};
  walk(name); return result;
}
test('supertrait cached closure matches an independent DAG oracle and stays immutable', () => {
  let seed = 0x98143;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  for (let iteration = 0; iteration < 12; iteration++) {
    const graph = {};
    for (let i = 0; i < 40; i++) graph['T' + i] = Array.from({length: i}, (_, j) => 'T' + j).filter(() => random() < .12);
    const input = index(graph), before = JSON.stringify([...input.traits]);
    const hierarchy = new TraitHierarchy(input);
    for (const name of Object.keys(graph)) {
      const first = hierarchy.closure(name); assert.deepEqual(first, oracle(graph, name));
      assert.equal(hierarchy.closure(name), first); assert.equal(Object.isFrozen(first), true);
    }
    assert.equal(JSON.stringify([...input.traits]), before);
    assert.equal(hierarchy.snapshot().cacheHits, 40);
  }
});
test('supertrait graph handles deep hierarchies and cycle paths iteratively', () => {
  const graph = {};
  for (let i = 0; i < 5000; i++) graph['T' + i] = i ? ['T' + (i - 1)] : [];
  assert.equal(new TraitHierarchy(index(graph)).closure('T4999').length, 5000);
  graph.T0 = ['T4999'];
  assert.throws(() => new TraitHierarchy(index(graph)), error => error.code === 'E0391' && error.message.includes('T4999'));
});
test('supertrait caches evict without changing proofs and enforce resource limits', () => {
  const input = index({A: [], B: ['A'], C: ['B'], D: ['B']});
  const hierarchy = new TraitHierarchy(input, {maxEntries: 1, maxCharacters: 16});
  for (let i = 0; i < 12; i++) for (const name of ['C', 'D']) {
    assert.deepEqual(hierarchy.closure(name), [name, 'B', 'A']);
    assert.ok(hierarchy.snapshot().cacheEntries <= 1);
    assert.ok(hierarchy.snapshot().cacheCharacters <= 16);
  }
  assert.throws(() => new TraitHierarchy(input, {maxEdges: 1}), error => error.code === 'F_TRAIT_HIERARCHY_LIMIT');
  assert.throws(() => new TraitHierarchy(input, {maxVisits: 1}), error => error.code === 'F_TRAIT_HIERARCHY_LIMIT');
  const noCache = new TraitHierarchy(input, {maxEntries: 0}); noCache.closure('C'); assert.equal(noCache.cache.size, 0);
});
test('supertrait builtin identity never aliases a user trait with the same final name', () => {
  const hierarchy = new TraitHierarchy(index({Copy: [], Child: ['Copy']}));
  assert.deepEqual(hierarchy.closure('Child'), ['Child', 'Copy']);
  assert.deepEqual(hierarchy.closure(hierarchy.canonical('core::marker::Copy')), ['core::marker::Copy', 'core::clone::Clone', 'core::marker::Sized']);
  assert.equal(hierarchy.builtinName('Copy'), null);
});
test('supertrait graph rebuilds after edits and query snapshots remain replayable', () => {
  const cache = new CompilerCache();
  const source = 'trait A{}trait B:A{}struct C;impl A for C{}impl B for C{}fn main(){}';
  const first = compile(source, {cache}); const before = JSON.stringify(first.hir);
  const replay = compile(source, {cache}); assert.equal(JSON.stringify(replay.hir), before);
  assert.throws(() => compile(source.replace('impl A for C{}', ''), {cache}), error => error.code === 'E0277');
  assert.doesNotThrow(() => compile(source.replace('trait B:A', 'trait B'), {cache}));
  assert.equal(JSON.stringify(first.hir), before);
});
