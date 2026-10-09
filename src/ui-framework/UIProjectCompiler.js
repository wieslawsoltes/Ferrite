import {Lexer} from '../compiler/Lexer.js';
import {Parser} from '../compiler/Parser.js';
import {ModuleResolver} from '../project/ModuleResolver.js';
import {VirtualFileSystem as V} from '../project/VirtualFileSystem.js';
import {ViewSyntax} from './ViewSyntax.js';
import {UI_ABI_FILE, UI_DECLARATIONS} from './RustAbi.js';

/** Resolve external Rust modules through ASTs, expanding view! in each source file. */
export function prepareUIProject(source, {file, files = {}, configuration} = {}) {
  const inputs = V.validate({...files, [file]: source}), expansions = new Map();
  const cache = {parse(path, source) {
    const start = performance.now(), expansion = new ViewSyntax(source, {file: path}).expand();
    const tokens = Lexer.tokenize(expansion.source, {file: path});
    for (const token of tokens) {
      const span = expansion.mapSpan(token.span);
      Object.assign(token, {span, offset: span.start, end: span.end, file: path, line: span.line, column: span.column});
    }
    const parsed = {file: path, source, tokens, ast: Parser.parse(tokens), lexMs: performance.now() - start, parseMs: 0};
    expansions.set(path, expansion); return parsed;
  }};
  const resolver = new ModuleResolver(inputs, cache), ast = resolver.resolve(file, {configuration});
  // ModuleResolver preserves declared module namespaces and the original file spans.
  ast.items.push(...Parser.parse(Lexer.tokenize(UI_DECLARATIONS, {file: UI_ABI_FILE})).items);
  return {ast, tokens: resolver.records.get(file).tokens, expansion: expansions.get(file),
    files: Object.fromEntries([...resolver.records].map(([path, record]) => [path, record.source])),
    modules: resolver.result.edges, nodes: [...expansions.values()].flatMap(expansion => expansion.nodes)};
}
