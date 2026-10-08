import {Lexer} from "./compiler/Lexer.js";
import {Parser} from "./compiler/Parser.js";
import {SemanticAnalyzer} from "./compiler/SemanticAnalyzer.js";
import {MirLowerer} from "./compiler/MirLowerer.js";
import {JavaScriptEmitter} from "./compiler/JavaScriptEmitter.js";

export const tokenize = source => Lexer.tokenize(source);
export const parse = tokens => Parser.parse(tokens);
export const analyze = ast => SemanticAnalyzer.analyze(ast);
export const lowerMir = sem => MirLowerer.lower(sem);
export const emitJS = sem => JavaScriptEmitter.emit(sem);

/** Creates an isolated pass result. Timings are wall-clock estimates, not CPU profiling. */
export function compile(source, {now = () => performance.now()} = {}) {
  const timings = [];
  function pass(name, action) {
    const start = now();
    const result = action();
    timings.push({name, ms: now() - start});
    return result;
  }
  const tokens = pass("Lex", () => tokenize(source));
  const ast = pass("Parse", () => parse(tokens));
  const semantic = pass("Analyze", () => analyze(ast));
  const mir = pass("Lower MIR", () => lowerMir(semantic));
  const js = pass("Emit JS", () => emitJS(semantic));
  const sem = {
    instances: semantic.instances.map(({key,name,typeArguments,returnType,fn,calls}) => ({
      key,name,typeArguments,returnType,calls,loc:fn.loc
    })),
    symbols: semantic.symbols,
    obligations: semantic.obligations,
    structures: semantic.structures
  };
  return {tokens,ast,sem,mir,js,timings};
}
