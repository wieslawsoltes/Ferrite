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
  const expansion = pass('Expand macros', () => MacroExpander.expand(ast));
  const semantic = pass('Types and instances', () => SemanticAnalyzer.analyze(expansion.ast, options));
  const ownership = pass('Ownership', () => OwnershipAnalyzer.analyze(semantic));
  const mir = pass('Lower MIR', () => MirLowerer.lower(semantic));
  const verification = pass('Verify MIR', () => MirVerifier.verify(mir));
  const optimized = pass('Optimize MIR', () => MirOptimizer.optimize(mir));
  const emitted = pass('Emit JavaScript', () => new JavaScriptEmitter(optimized.functions, {entry: semantic.entry, runtime: options.runtime}).build());
  const sem = {instances: semantic.instances.map(({key, name, fn, typeArguments, returnType, calls, locals}) => ({key, name, typeArguments, returnType, calls, locals, span: fn.span, loc: fn.loc})),
    symbols: semantic.symbols, structures: semantic.structures, enums: semantic.enums,
    obligations: semantic.obligations.map(o => `${o.type}: ${o.trait}`), traitObligations: semantic.obligations, warnings: semantic.warnings};
  return {version: '0.5.0', tokens, ast, expanded: expansion.ast, expansions: expansion.expansions,
    hir: semantic.instances.map(({key, fn}) => ({instance: key, body: fn.body, span: fn.span})), sem, ownership, mir,
    optimizedMir: optimized.functions, optimizations: optimized.changes, verification, js: emitted.code,
    generatedMap: emitted.sourceMap, entry: semantic.entry, timings, diagnostics: semantic.warnings};
}
