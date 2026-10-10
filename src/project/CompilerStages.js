import {CallGraphBuilder} from '../compiler/CallGraphBuilder.js';

/** Shared inspector contract. Frontends supply real artifacts, never invented passes. */
export function compilerStages(build, {plan, units = [], edges = [], configuration = [], cacheHit = false, extra = []} = {}) {
  const graph = CallGraphBuilder.build(build.ast, build.sem.instances);
  graph.roots = build.entry ? [build.entry] : graph.nodes.slice(0, 1).map(node => node.id);
  return [
    ...(plan ? [{name: 'Cargo', kind: 'cargo', data: plan}] : []),
    ...extra,
    {name: 'Modules', kind: 'modules', data: {files: units, edges}},
    {name: 'Tokens', kind: 'tokens', data: build.tokens},
    {name: 'AST', kind: 'tree', data: build.ast},
    {name: 'Configuration', kind: 'configuration', data: [...configuration, ...(build.configuration ?? [])]},
    {name: 'Macro expansion', kind: 'expansions', data: build.expansions},
    {name: 'Typed HIR', kind: 'tree', data: build.hir},
    {name: 'HIR / Symbols', kind: 'symbols', data: build.sem.symbols},
    {name: 'Types / Traits', kind: 'types', data: build.sem},
    {name: 'Ownership', kind: 'ownership', data: build.ownership},
    {name: 'Pattern coverage', kind: 'patterns', data: build.sem.patterns},
    {name: 'Closure captures', kind: 'closures', data: build.sem.closures ?? []},
    {name: 'Generic Instances', kind: 'instances', data: build.sem.instances},
    {name: 'MIR / CFG', kind: 'cfg', data: build.mir},
    {name: 'MIR verification', kind: 'verification', data: build.verification},
    {name: 'Optimized MIR', kind: 'cfg', data: build.optimizedMir},
    {name: 'Optimizations', kind: 'optimizations', data: build.optimizations},
    {name: 'Call Graph', kind: 'callgraph', data: graph},
    {name: 'Incremental queries', kind: 'queries', data: cacheHit ? {...build.queries, projectCacheHit: true} : build.queries},
    {name: 'WebAssembly', kind: 'wasm', data: build.wasm},
    {name: 'JavaScript', kind: 'code', data: {code: build.js, mappings: build.generatedMap}}
  ];
}
