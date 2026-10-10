import {AgentError} from '../core/AgentError.js';
import {BrowserCompiler} from './BrowserCompiler.js';
import {RustDocument, RUST_KEYWORDS, SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS} from '../../language/RustDocument.js';
import {RustLanguageIndex} from '../../language/RustLanguageIndex.js';
import {UILanguageCatalog} from '../../language/UILanguageCatalog.js';

/** Source-aware browser tooling over canonical typed HIR, not an emulated rust-analyzer. */
export class BrowserLanguageService {
  constructor(workspace, compiler, {uiCompilerFactory = () => new BrowserCompiler({workerFactory:() => new Worker(new URL('../../ui/workers/ui-language-worker.js', import.meta.url), {type:'module'})})} = {}) {
    this.workspace = workspace; this.compiler = compiler; this.uiCompilerFactory = uiCompilerFactory; this.risk = 'read'; this.documents = new Map(); this.cache = null;
    this.methods = new Set(['textDocument/documentSymbol','workspace/symbol','textDocument/hover','textDocument/definition','textDocument/references','textDocument/completion',
      'textDocument/signatureHelp','textDocument/semanticTokens/full','textDocument/semanticTokens/range','textDocument/diagnostic','textDocument/documentHighlight',
      'textDocument/inlayHint','textDocument/foldingRange','textDocument/prepareRename','textDocument/rename','rust-analyzer/syntaxTree','rust-analyzer/viewHir','rust-analyzer/viewMir']);
    this.semanticTokensLegend = {tokenTypes:SEMANTIC_TOKEN_TYPES, tokenModifiers:SEMANTIC_TOKEN_MODIFIERS};
    this.description = 'Analyze Rust and view! using original UTF-16 source, the compiler UI ABI and resolved typed HIR. Browser symbols, hover, definition, references, exact-local rename previews, completion, signatures, semantic tokens, diagnostics, hints and folding need no native bridge. Incomplete code returns labelled syntax candidates, not fabricated bindings. Full Rust/crate analysis requires native rust-analyzer.';
  }
  static point(text, offset) { const prefix = text.slice(0, offset); return {line:prefix.split('\n').length - 1, character:offset - (prefix.lastIndexOf('\n') + 1)}; }
  static offset(text, position) {
    if (!position || !Number.isSafeInteger(position.line) || !Number.isSafeInteger(position.character) || position.line < 0 || position.character < 0) throw Error('Expected a zero-based UTF-16 position');
    const lines = text.split('\n'); if (position.line >= lines.length || position.character > lines[position.line].replace(/\r$/, '').length) throw Error('Position is outside this document');
    return lines.slice(0, position.line).reduce((n,line) => n + line.length + 1, 0) + position.character;
  }
  static range(files, span) { return {start:this.point(files[span.file], span.start), end:this.point(files[span.file], span.end)}; }
  static location(files, span) { return {uri:'ferrite://workspace/' + span.file.split('/').map(encodeURIComponent).join('/'), range:this.range(files, span)}; }
  static index(build, files) { return new RustLanguageIndex(build, files); }
  document(file, text) {
    let document = this.documents.get(file);
    if (!document || document.text !== text) { document = new RustDocument(text, file); this.documents.set(file, document); }
    return document;
  }
  current(snapshot, signal) {
    this.workspace.assertCurrent(signal);
    if (this.workspace.model && this.workspace.model.revision !== snapshot.revision) throw new AgentError('STALE_LANGUAGE_RESULT', 'Source changed during language analysis; request it again.');
  }
  async analyze(snapshot, path, options, signal) {
    const {files} = snapshot, document = path ? this.document(path, files[path]) : null;
    const entry = options.uiEntryFile ?? (document && (path.endsWith('.ui.rs') || document.macros.length || document.tokens.some((t,i) => t.name === 'ui' && document.tokens[i + 1]?.value === '::')) ? path : null);
    const settings = JSON.stringify({...options, uiEntryFile:entry}), cached = this.cache;
    if (cached && cached.revision === snapshot.revision && cached.settings === settings && Object.keys(cached.files).length === Object.keys(files).length && Object.keys(files).every(file => cached.files[file] === files[file])) return cached;
    let build, error;
    try {
      const compiler = entry ? this.uiCompiler ??= this.uiCompilerFactory() : this.compiler;
      build = await compiler.compile(files, entry ? 'ui-language' : 'check', entry ? {file:entry, configuration:options.configuration} : options, signal);
    } catch (failure) {
      this.current(snapshot, signal);
      if (failure.name === 'AbortError' || ['COMPILER_TIMEOUT','COMPILER_WORKER','COMPILER_MESSAGE','COMPILER_CLOSED'].includes(failure.code)) throw failure;
      error = failure;
    }
    this.current(snapshot, signal);
    for (const file of this.documents.keys()) if (!Object.hasOwn(files,file)) this.documents.delete(file);
    const index = new RustLanguageIndex(build ?? {}, files, this.documents), diagnostics = error ? [{code:error.code ?? 'LANGUAGE', message:error.message, span:error.span, notes:error.notes}] : build.diagnostics ?? [];
    return this.cache = {files:{...files}, revision:snapshot.revision, settings, build, index, diagnostics, error, backend:entry ? 'ferrite-ui' : 'ferrite-browser'};
  }
  async request(method, {path, params = {}, options = {}} = {}, signal) {
    if (!this.methods.has(method)) throw new AgentError('BROWSER_LANGUAGE_METHOD', 'This Rust method requires native rust-analyzer');
    const snapshot = await this.workspace.snapshot(); this.current(snapshot, signal);
    if (path !== undefined) path = this.workspace.normalize(path);
    if (method !== 'workspace/symbol' && (!Object.hasOwn(snapshot.files,path) || !path.endsWith('.rs'))) throw Error('Select an existing browser Rust source file');
    const {files} = snapshot, document = path ? this.document(path,files[path]) : null;
    const location = span => BrowserLanguageService.location(files,span), range = span => BrowserLanguageService.range(files,span);
    const positioned = new Set(['textDocument/completion','textDocument/hover','textDocument/definition','textDocument/references','textDocument/documentHighlight','textDocument/signatureHelp','textDocument/prepareRename','textDocument/rename']);
    const offset = positioned.has(method) ? BrowserLanguageService.offset(files[path],params.position) : null;
    // Catalog and lexical services remain instant, including inside broken view source.
    if (method === 'textDocument/completion' && !['rust','tag'].includes(UILanguageCatalog.context(document,offset).kind)) return UILanguageCatalog.completion(document,offset);
    if (method === 'textDocument/hover') { const hover = UILanguageCatalog.hover(document,offset); if (hover) return {contents:{kind:'plaintext',value:hover.value},range:range(hover.span)}; }
    if (method === 'textDocument/signatureHelp') { const signature = UILanguageCatalog.signatureHelp(document,offset); if (signature) return signature; }
    if (method === 'textDocument/semanticTokens/full' || method === 'textDocument/semanticTokens/range') return {...document.semanticTokens({range:params.range}), resultId:String(snapshot.revision)};
    const analysis = await this.analyze(snapshot,path,options,signal), {build,index,diagnostics,backend} = analysis;
    this.current(snapshot,signal);
    const filter = item => !path || item.span.file === path;
    if (method === 'textDocument/diagnostic') return {kind:'full',resultId:String(snapshot.revision),items:diagnostics.filter(d => !d.span || d.span.file === path).map(d => ({range:d.span ? range(d.span) : {start:{line:0,character:0},end:{line:0,character:0}},severity:d.severity === 'warning' ? 2 : 1,code:d.code,source:backend,message:d.message, data:{notes:d.notes ?? []}}))};
    if (method.startsWith('rust-analyzer/')) {
      if (analysis.error) throw analysis.error;
      if (method === 'rust-analyzer/viewMir' && !build.optimizedMir) throw new AgentError('BROWSER_LANGUAGE_METHOD', 'UI language analysis does not emit MIR. Use UI compilation or the native backend.');
      return {backend,diagnostics,...(method.endsWith('syntaxTree') ? {ast:build.ast} : method.endsWith('viewHir') ? {hir:build.hir} : {mir:build.optimizedMir})};
    }
    if (method === 'textDocument/completion') return UILanguageCatalog.completion(document,offset,analysis.error ? RustLanguageIndex.syntaxCandidates(document,offset) : index.candidates(path,offset));
    if (method === 'textDocument/signatureHelp') return UILanguageCatalog.signatureHelp(document,offset,index.signatures.filter(s => s.selection.file === path || s.qualifiedName?.includes('::')));
    if (method === 'workspace/symbol') return index.symbols.filter(item => item.name.toLowerCase().includes(String(params.query ?? '').toLowerCase())).slice(0,1000).map(item => ({name:item.name,kind:item.kind === 'fn' ? 12 : 5,location:location(item.selection)}));
    if (method === 'textDocument/documentSymbol') return index.symbols.filter(filter).map(item => ({name:item.name,kind:item.kind === 'fn' ? 12 : 5,range:range(item.span),selectionRange:range(item.selection)}));
    if (method === 'textDocument/foldingRange') return index.symbols.filter(filter).filter(item => range(item.span).end.line > range(item.span).start.line).map(item => ({startLine:range(item.span).start.line,endLine:range(item.span).end.line,kind:'region'}));
    if (method === 'textDocument/inlayHint') return index.occurrences.filter(item => filter(item) && item.declaration && item.key.startsWith('binding:')).map(item => ({position:range(item.span).end,label:': ' + item.type,kind:1,paddingLeft:true}));
    const found = index.at(path,offset);
    if (!found) {
      if (analysis.error && ['textDocument/rename','textDocument/prepareRename'].includes(method)) throw new AgentError('RENAME_UNRESOLVED', 'Fix the source diagnostics before renaming; no guessed or partial rename edits are produced.');
      return ['textDocument/references','textDocument/documentHighlight'].includes(method) ? [] : null;
    }
    if (method === 'textDocument/hover') return {contents:{kind:'plaintext',value:`${found.name}: ${found.type}\n${backend} · resolved source binding · revision ${snapshot.revision}`},range:range(found.span)};
    if (method === 'textDocument/definition') return location(found.definition);
    if (method === 'textDocument/references') return index.occurrences.filter(item => item.key === found.key && (params.context?.includeDeclaration !== false || !item.declaration)).map(item => location(item.span));
    if (method === 'textDocument/documentHighlight') return index.occurrences.filter(item => item.key === found.key && filter(item)).map(item => ({range:range(item.span),kind:item.declaration ? 3 : 2}));
    if (!found.key.startsWith('binding:')) throw new AgentError('RENAME_NATIVE_REQUIRED', 'Browser rename previews support resolved local bindings only; use native rust-analyzer for module/import/function renames');
    if (method === 'textDocument/prepareRename') return {range:range(found.span),placeholder:files[path].slice(found.span.start,found.span.end)};
    const name = params.newName, normalized = typeof name === 'string' ? name.replace(/^r#/, '').normalize('NFC') : '', raw = typeof name === 'string' && name.startsWith('r#');
    if (typeof name !== 'string' || !/^(?:r#)?[\p{XID_Start}_][\p{XID_Continue}_]*$/u.test(name) || normalized === '_' || (raw ? ['self','Self','super','crate'].includes(normalized) : RUST_KEYWORDS.has(normalized))) throw Error('Enter a valid non-keyword Rust identifier (or a legal raw identifier)');
    // Conservative capture prevention includes lexically present names in incomplete/unresolved paths.
    if (index.occurrences.some(item => item.key !== found.key && item.span.file === path && item.name === normalized) || document.tokens.some(t => t.identifier && t.name === normalized && !index.occurrences.some(o => o.key === found.key && o.span.file === path && o.span.start === t.start))) throw new AgentError('RENAME_COLLISION', 'The requested name is already present; use native analysis for a scope-aware rename');
    const changes = Object.create(null);
    for (const item of index.occurrences.filter(item => item.key === found.key)) (changes[location(item.span).uri] ??= []).push({range:range(item.span),newText:name});
    return {changes,ferrite:{previewOnly:true,revision:snapshot.revision,hashes:snapshot.hashes,backend}};
  }
  async close() { this.cache = null; this.documents.clear(); await this.uiCompiler?.close(); }
}
