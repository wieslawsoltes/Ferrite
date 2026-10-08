import {AgentError} from '../core/AgentError.js';

/** Source-aware analysis of Ferrite's actual typed HIR. Not an emulated rust-analyzer server. */
export class BrowserLanguageService {
  constructor(workspace, compiler) {
    this.workspace = workspace; this.compiler = compiler; this.risk = 'read';
    this.methods = new Set(['textDocument/documentSymbol', 'workspace/symbol', 'textDocument/hover', 'textDocument/definition', 'textDocument/references',
      'textDocument/completion', 'textDocument/inlayHint', 'textDocument/foldingRange', 'textDocument/prepareRename', 'textDocument/rename',
      'rust-analyzer/syntaxTree', 'rust-analyzer/viewHir', 'rust-analyzer/viewMir']);
    this.description = 'Analyze the browser Rust subset using Ferrite tokens, AST and resolved typed HIR. Supports symbols, hover, definition, references, exact-binding rename previews, inlay hints, folding and syntax/HIR/MIR views. Completion is a labelled candidate list, not full rust-analyzer completion. Edits are previews only. All positions use zero-based UTF-16. Native rust-analyzer methods are available only in native mode.';
  }
  static point(text, offset) {
    const prefix = text.slice(0, offset), line = prefix.split('\n').length - 1;
    return {line, character: offset - (prefix.lastIndexOf('\n') + 1)};
  }
  static offset(text, position) {
    if (!position || !Number.isSafeInteger(position.line) || !Number.isSafeInteger(position.character) || position.line < 0 || position.character < 0) throw Error('Expected a zero-based UTF-16 position');
    const lines = text.split('\n'); if (position.line >= lines.length || position.character > lines[position.line].replace(/\r$/, '').length) throw Error('Position is outside this document');
    return lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character;
  }
  static range(files, span) { return {start: this.point(files[span.file], span.start), end: this.point(files[span.file], span.end)}; }
  static location(files, span) { return {uri: 'ferrite://workspace/' + span.file.split('/').map(encodeURIComponent).join('/'), range: this.range(files, span)}; }
  static index(build, files) {
    const symbols = [], occurrences = [], declarations = new Map();
    const tokenName = (span, name) => build.tokens.find(token => token.file === span?.file && token.span?.start >= span.start && token.span.end <= span.end && token.value === name)?.span;
    for (const symbol of build.sem?.symbols ?? []) {
      if (!Object.hasOwn(files, symbol.span?.file)) continue;
      const name = symbol.name.split('::').at(-1), selection = tokenName(symbol.span, name);
      if (!selection) continue;
      const key = 'symbol:' + symbol.name;
      symbols.push({...symbol, name, selection, key}); declarations.set(key, selection);
      occurrences.push({key, name, span: selection, definition: selection, type: symbol.kind, declaration: true});
    }
    const seen = new WeakSet();
    const visit = (node, instance) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return; seen.add(node);
      if (node.binding?.span && Object.hasOwn(files, node.binding.span.file)) {
        const binding = node.binding, definition = tokenName(binding.span, binding.name);
        const span = node.kind === 'variable' ? node.span : node.kind === 'bindingPattern' ? definition : null;
        if (definition && span) {
          const key = `binding:${definition.file}:${definition.start}:${binding.slot}`;
          declarations.set(key, definition); occurrences.push({key, name: binding.name, span, definition, type: binding.type, declaration: node.kind !== 'variable'});
        }
      }
      if (node.kind === 'call' && typeof node.resolved === 'string' && node.callee?.span) {
        const target = (build.sem?.instances ?? []).find(item => item.key === node.resolved), key = 'symbol:' + (target?.name ?? node.resolved.split('<')[0]);
        if (declarations.has(key)) occurrences.push({key, name: node.callee.name, span: node.callee.span, definition: declarations.get(key), type: target?.returnType ?? node.type});
      }
      for (const [key, child] of Object.entries(node)) if (!['span', 'loc', 'binding'].includes(key)) {
        if (Array.isArray(child)) for (const item of child) visit(item, instance); else if (child && typeof child === 'object') visit(child, instance);
      }
    };
    for (const hir of build.hir ?? []) visit(hir.body, hir.instance);
    const unique = new Map(occurrences.map(item => [`${item.key}:${item.span.file}:${item.span.start}:${item.span.end}`, item]));
    return {symbols, occurrences: [...unique.values()], declarations};
  }
  async request(method, {path, params = {}, options = {}} = {}, signal) {
    if (!this.methods.has(method)) throw new AgentError('BROWSER_LANGUAGE_METHOD', 'This Rust method requires native rust-analyzer');
    const snapshot = await this.workspace.snapshot(); this.workspace.assertCurrent(signal);
    if (path !== undefined) path = this.workspace.normalize(path);
    if (method !== 'workspace/symbol' && !Object.hasOwn(snapshot.files, path)) throw Error('Select an existing browser source file');
    const build = await this.compiler.compile(snapshot.files, 'check', options, signal); this.workspace.assertCurrent(signal);
    const {files} = snapshot, index = BrowserLanguageService.index(build, files), source = files[path], location = span => BrowserLanguageService.location(files, span), range = span => BrowserLanguageService.range(files, span);
    const filter = item => !path || item.span.file === path;
    if (method === 'rust-analyzer/syntaxTree') return {backend: 'ferrite-browser', ast: build.ast, diagnostics: build.diagnostics};
    if (method === 'rust-analyzer/viewHir') return {backend: 'ferrite-browser', hir: build.hir, diagnostics: build.diagnostics};
    if (method === 'rust-analyzer/viewMir') return {backend: 'ferrite-browser', mir: build.optimizedMir, diagnostics: build.diagnostics};
    if (method === 'workspace/symbol') return index.symbols.filter(item => item.name.toLowerCase().includes(String(params.query ?? '').toLowerCase())).slice(0, 1000).map(item => ({name: item.name, kind: item.kind === 'fn' ? 12 : 5, location: location(item.selection)}));
    if (method === 'textDocument/documentSymbol') return index.symbols.filter(filter).map(item => ({name: item.name, kind: item.kind === 'fn' ? 12 : 5, range: range(item.span), selectionRange: range(item.selection)}));
    if (method === 'textDocument/foldingRange') return index.symbols.filter(filter).filter(item => range(item.span).end.line > range(item.span).start.line).map(item => ({startLine: range(item.span).start.line, endLine: range(item.span).end.line, kind: 'region'}));
    if (method === 'textDocument/inlayHint') return index.occurrences.filter(item => filter(item) && item.declaration && item.key.startsWith('binding:')).map(item => ({position: range(item.span).end, label: ': ' + item.type, kind: 1, paddingLeft: true}));
    const offset = BrowserLanguageService.offset(source, params.position), found = index.occurrences.filter(filter).filter(item => item.span.start <= offset && offset < item.span.end).sort((a, b) => (a.span.end - a.span.start) - (b.span.end - b.span.start))[0];
    if (method === 'textDocument/completion') return {isIncomplete: true, items: [...new Map(index.occurrences.filter(filter).map(item => [item.name, {label: item.name, kind: item.key.startsWith('symbol:') ? 3 : 6, detail: `${item.type} · Ferrite document candidate; scope/applicability not guaranteed`}])).values()]};
    if (!found) return method === 'textDocument/references' ? [] : null;
    if (method === 'textDocument/hover') return {contents: {kind: 'plaintext', value: `${found.name}: ${found.type}\nFerrite browser subset · source revision ${snapshot.revision}`}, range: range(found.span)};
    if (method === 'textDocument/definition') return location(found.definition);
    if (method === 'textDocument/references') return index.occurrences.filter(item => item.key === found.key && (params.context?.includeDeclaration !== false || !item.declaration)).map(item => location(item.span));
    // Function/type rename needs module/import rewriting; only exact HIR local bindings are safe here.
    if (!found.key.startsWith('binding:')) throw new AgentError('RENAME_NATIVE_REQUIRED', 'Browser rename previews support resolved local bindings only; use native rust-analyzer for module/import/function renames');
    if (method === 'textDocument/prepareRename') return {range: range(found.span), placeholder: found.name};
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(params.newName) || ['fn','let','mut','self','Self','super','crate','async','await','move','ref','type','struct','enum','impl','trait','use','pub','return','match','if','else','while','for','in','loop','break','continue','const','static','where','dyn','as','true','false','unsafe','extern','mod'].includes(params.newName)) throw Error('Enter a non-keyword Rust identifier');
    if (index.occurrences.some(item => item.key !== found.key && item.span.file === path && item.name === params.newName)) throw new AgentError('RENAME_COLLISION', 'The requested name is already present; use native analysis for a scope-aware rename');
    const changes = Object.create(null);
    for (const item of index.occurrences.filter(item => item.key === found.key)) (changes[location(item.span).uri] ??= []).push({range: range(item.span), newText: params.newName});
    return {changes, ferrite: {previewOnly: true, revision: snapshot.revision, hashes: snapshot.hashes, backend: 'ferrite-browser'}};
  }
  async close() {}
}
