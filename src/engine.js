import {WebAssemblyEmitter} from './compiler/wasm/WebAssemblyEmitter.js';
import {Configuration} from './compiler/Configuration.js';
import {Lexer} from './compiler/Lexer.js';
import {Parser} from './compiler/Parser.js';
import {MacroExpander} from './compiler/MacroExpander.js';
import {SemanticAnalyzer} from './compiler/SemanticAnalyzer.js';
import {OwnershipAnalyzer} from './compiler/OwnershipAnalyzer.js';
import {MirLowerer} from './compiler/MirLowerer.js';
import {MirVerifier} from './compiler/MirVerifier.js';
import {MirOptimizer} from './compiler/MirOptimizer.js';
import {JavaScriptEmitter} from './compiler/JavaScriptEmitter.js';

export const tokenize = (source, options) => Lexer.tokenize(source, options);
export const parse = tokens => Parser.parse(tokens);
export const analyze = ast => SemanticAnalyzer.analyze(ast);
export const lowerMir = semantic => MirLowerer.lower(semantic);
export const emitJS = semantic => JavaScriptEmitter.emit(semantic);

/** Stable functional API; consumers may inject parsed file-aware ASTs and clocks. */
export function compile(source, options = {}) {
  const {now = () => performance.now(), file = 'src/main.rs'} = options;
  const timings = [];
  const pass = (name, action) => { const start = now(); const result = action(); timings.push({name, ms: now() - start}); return result; };
  const tokens = options.tokens ?? pass('Lex', () => tokenize(source, {file}));
  const ast = options.ast ?? pass('Parse', () => parse(tokens));
  const configured = pass('Conditional compilation', () => Configuration.apply(ast, options.configuration));
  const expansion = pass('Expand macros', () => MacroExpander.expand(configured.ast));
  const semantic = pass('Types and instances', () => SemanticAnalyzer.analyze(expansion.ast, options));
  const perInstance = (stage, action) => semantic.instances.map(instance => {
    const run = () => action({...semantic, instances: [instance]})[0];
    return options.queryCache ? options.queryCache.run(stage, JSON.stringify(instance), {id: instance.key, span: instance.fn.span, dependencies: [`type:${instance.key}`]}, run) : run();
  });
  const ownership = pass('Ownership', () => perInstance('ownership', s => OwnershipAnalyzer.analyze(s)));
  const mir = pass('Lower MIR', () => perInstance('mir', s => MirLowerer.lower(s)));
  const verification = pass('Verify MIR', () => MirVerifier.verify(mir));
  const optimized = options.optimize === false ? {functions: mir, changes: []} : pass('Optimize MIR', () => MirOptimizer.optimize(mir));
  const emitted = pass('Emit JavaScript', () => new JavaScriptEmitter(optimized.functions, {entry: semantic.entry ?? null, runtime: options.runtime}).build());
  const wasm = pass('Emit WebAssembly', () => new WebAssemblyEmitter(optimized.functions, {entry: semantic.entry ?? null}).build());
  // Plain byte arrays keep cached artifacts deeply immutable and structured-cloneable.
  wasm.bytes = Array.from(wasm.bytes);
  const sem = {instances: semantic.instances.map(({key, name, fn, typeArguments, returnType, calls, locals}) => ({key, name, typeArguments, returnType, calls, locals, span: fn.span, loc: fn.loc})),
    typeResolution:semantic.typeResolution, patterns:semantic.patterns, closures:semantic.closures, symbols: semantic.symbols, structures: semantic.structures, enums: semantic.enums,
    obligations: semantic.obligations.map(o => `${o.type}: ${o.trait}`), traitObligations: semantic.obligations, warnings: semantic.warnings};
  return {version: '0.8.0', wasm, configuration:configured.decisions, tokens, ast, expanded: expansion.ast, expansions: expansion.expansions,
    hir: semantic.instances.map(({key, fn}) => ({instance: key, body: fn.body, span: fn.span})), sem, ownership, mir,
    optimizedMir: optimized.functions, optimizations: optimized.changes, verification, js: emitted.code,
    generatedMap: emitted.sourceMap, entry: semantic.entry, queries: options.queryCache?.snapshot() ?? null, timings, diagnostics: semantic.warnings};
}
