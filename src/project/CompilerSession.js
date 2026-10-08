import {compile} from '../engine.js';
import {Diagnostic} from '../compiler/Diagnostic.js';
import {CallGraphBuilder} from '../compiler/CallGraphBuilder.js';
import {CargoWorkspace} from '../cargo/CargoWorkspace.js';
import {ModuleResolver} from './ModuleResolver.js';
import {FileParserCache} from './FileParserCache.js';
import {VirtualFileSystem as V} from './VirtualFileSystem.js';

/** Independent project compilation session. Caches syntax by file, semantics by exact project. */
export class CompilerSession {
  constructor() { this.syntax = new FileParserCache(); this.results = new Map(); this.hits = 0; this.misses = 0; this.keyCharacters = 0; }
  static freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) this.freeze(child);
    return Object.freeze(value);
  }
  clear() { this.syntax.clear(); this.results.clear(); this.keyCharacters = 0; this.hits = 0; this.misses = 0; }
  compile(input, command = 'check', options = {}) {
    const start = performance.now(), files = V.validate(input), cargo = new CargoWorkspace(files), plan = cargo.plan(command, options);
    if (plan.errors.length) throw new Diagnostic('C0001', plan.errors.map(d => d.message).join('; '), plan.errors[0]?.span);
    if (plan.dependencies.length) throw new Diagnostic('C0002', `External Cargo dependencies require the native Cargo backend: ${plan.dependencies.join(', ')}`, plan.graph.find(e => e.to.startsWith('registry:') || e.spec.git)?.span);
    if (plan.nativeRequired.length) throw new Diagnostic('C0003', plan.nativeRequired.join('; '), plan.manifest.spans.package);
    const mode = command === 'test' || plan.target.kind === 'lib' ? 'library' : 'run';
    const key = JSON.stringify([Object.keys(files).sort().map(path => [path, files[path]]), command, options]);
    const hit = this.results.get(key); let compilation, moduleInfo, tests, syntaxStats;
    if (hit) {
      this.hits++; this.results.delete(key); this.results.set(key, hit);
      ({compilation, moduleInfo, tests, syntaxStats} = hit);
      syntaxStats = {...syntaxStats, reusedFiles: moduleInfo.files.length, parsedFiles: 0};
    } else {
      this.misses++; const resolver = new ModuleResolver(files, this.syntax);
      const packageAst = (id, target, root = '', stack = []) => {
        if (stack.includes(id)) throw new Diagnostic('C0004', 'Local dependency cycle');
        const ast = resolver.resolve(target.path, {crateRoot: root, dependency: !!root});
        for (const edge of plan.graph.filter(e => e.from === id && !e.to.startsWith('registry:') && e.spec.path)) {
          const dependency = plan.packages.find(p => p.id === edge.to), library = dependency.targets.find(t => t.kind === 'lib');
          const name = [root, edge.alias].filter(Boolean).join('::');
          const nested = packageAst(edge.to, library, name, [...stack, id]);
          ast.items.unshift({kind: 'mod', name: edge.alias, visibility: 'pub', external: false, module: root, crateRoot: root, items: nested.items, span: edge.span});
        }
        return ast;
      };
      const ast = packageAst(plan.selected, plan.target);
      // Binary and library are distinct crate namespaces, even in a single Cargo package.
      const ownPackage = plan.packages.find(p => p.id === plan.selected), ownLibrary = ownPackage.targets.find(t => t.kind === 'lib');
      if (plan.target.kind === 'bin' && ownLibrary) {
        const library = packageAst(plan.selected, ownLibrary, ownLibrary.name);
        ast.items.unshift({kind: 'mod', name: ownLibrary.name, visibility: 'pub', external: false, items: library.items});
      }
      moduleInfo = resolver.result;
      const tokens = moduleInfo.files.flatMap(file => file.tokens);
      const source = files[plan.entry];
      compilation = compile(source, {...options, file: plan.entry, ast, tokens, mode});
      syntaxStats = {reusedFiles: moduleInfo.files.filter(f => f.cached).length, parsedFiles: moduleInfo.files.filter(f => !f.cached).length};
      const declarations = new Map();
      const visit = (items, namespace = '') => { for (const item of items) {
        if (item.kind === 'mod') visit(item.items, [namespace, item.name].filter(Boolean).join('::'));
        else if (item.kind === 'fn') declarations.set([namespace, item.name].filter(Boolean).join('::'), item);
      }};
      visit(ast.items);
      tests = compilation.sem.instances.filter(i => declarations.get(i.name)?.attributes?.some(a => a.name === 'test')).map(i => ({name: i.name, instance: i.key, span: i.span,
        ignore: declarations.get(i.name).attributes.some(a => a.name === 'ignore'), shouldPanic: declarations.get(i.name).attributes.some(a => a.name === 'should_panic')}));
      compilation.timings.unshift({name: 'Lex files', ms: moduleInfo.files.reduce((n, f) => n + f.lexMs, 0)}, {name: 'Parse files', ms: moduleInfo.files.reduce((n, f) => n + f.parseMs, 0)});
      this.results.set(key, CompilerSession.freeze({compilation, moduleInfo, tests, syntaxStats})); this.keyCharacters += key.length;
      while (this.results.size > 8 || this.keyCharacters > 8_000_000) {
        const oldest = this.results.keys().next().value; this.keyCharacters -= oldest.length; this.results.delete(oldest);
      }
    }
    const elapsedMs = performance.now() - start;
    const units = moduleInfo.files.map(f => ({file: f.file, tokens: f.tokens, source: f.source}));
    const stages = [
      {name: 'Cargo', kind: 'cargo', data: plan},
      {name: 'Modules', kind: 'modules', data: {files: units, edges: moduleInfo.edges}},
      {name: 'Tokens', kind: 'tokens', data: compilation.tokens},
      {name: 'AST', kind: 'tree', data: compilation.ast},
      {name: 'Macro expansion', kind: 'expansions', data: compilation.expansions},
      {name: 'Typed HIR', kind: 'tree', data: compilation.hir},
      {name: 'HIR / Symbols', kind: 'symbols', data: compilation.sem.symbols},
      {name: 'Types / Traits', kind: 'types', data: compilation.sem},
      {name: 'Ownership', kind: 'ownership', data: compilation.ownership},
      {name: 'Generic Instances', kind: 'instances', data: compilation.sem.instances},
      {name: 'MIR / CFG', kind: 'cfg', data: compilation.mir},
      {name: 'MIR verification', kind: 'verification', data: compilation.verification},
      {name: 'Optimized MIR', kind: 'cfg', data: compilation.optimizedMir},
      {name: 'Optimizations', kind: 'optimizations', data: compilation.optimizations},
      {name: 'Call Graph', kind: 'callgraph', data: CallGraphBuilder.build(compilation.ast, compilation.sem.instances)},
      {name: 'JavaScript', kind: 'code', data: {code: compilation.js, mappings: compilation.generatedMap}}
    ];
    return {...compilation, tests, stages, plan, cacheHit: !!hit, cache: {hits: this.hits, misses: this.misses, entries: this.results.size, ...syntaxStats},
      timings: hit ? [] : compilation.timings, elapsedMs,
      unit: {source: files[plan.entry], modules: units.map(f => f.file), files: units, sourceMap: []}};
  }
}
