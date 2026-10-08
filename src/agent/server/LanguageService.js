import {TerminalManager} from '../terminal/TerminalManager.js';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {relative, isAbsolute} from 'node:path';
import {RustAnalyzerSession} from '../../native/lsp/RustAnalyzerSession.js';
import {PersistentLanguageProject} from './PersistentLanguageProject.js';
import {AgentError} from '../core/AgentError.js';

/** Serialized LSP requests against the real checkout, with no implicit workspace/applyEdit. */
export class LanguageService {
  static methods = new Set(['textDocument/completion', 'completionItem/resolve', 'textDocument/hover', 'textDocument/definition', 'textDocument/declaration', 'textDocument/typeDefinition', 'textDocument/implementation', 'textDocument/references', 'textDocument/documentSymbol', 'workspace/symbol', 'textDocument/signatureHelp', 'textDocument/prepareRename', 'textDocument/rename', 'textDocument/formatting', 'textDocument/rangeFormatting', 'textDocument/codeAction', 'codeAction/resolve', 'textDocument/codeLens', 'codeLens/resolve', 'textDocument/inlayHint', 'inlayHint/resolve', 'textDocument/foldingRange', 'textDocument/selectionRange', 'textDocument/semanticTokens/full', 'textDocument/semanticTokens/range', 'textDocument/prepareCallHierarchy', 'callHierarchy/incomingCalls', 'callHierarchy/outgoingCalls', 'textDocument/prepareTypeHierarchy', 'typeHierarchy/supertypes', 'typeHierarchy/subtypes', 'rust-analyzer/viewSyntaxTree', 'rust-analyzer/expandMacro', 'rust-analyzer/viewHir', 'rust-analyzer/viewMir', 'experimental/runnables', 'rust-analyzer/relatedTests', 'experimental/parentModule', 'experimental/matchingBrace', 'experimental/joinLines', 'experimental/ssr', 'rust-analyzer/viewItemTree', 'rust-analyzer/viewCrateGraph', 'rust-analyzer/getFailedObligations']);
  constructor(workspace, events, {session = new RustAnalyzerSession({environment: TerminalManager.environment(process.env)})} = {}) { this.workspace = workspace; this.events = events; this.session = session; this.session.project = new PersistentLanguageProject(workspace.root); this.queue = Promise.resolve(); this.diagnostics = new Map(); this.peer = null; }
  async validateUris(value, depth = 0) {
    if (depth > 24) throw Error('LSP arguments too deeply nested');
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['uri', 'targetUri'].includes(key) && typeof item === 'string') {
        let path; try { path = fileURLToPath(item); } catch { throw Error('Only workspace file URIs are allowed in LSP requests'); }
        const local = relative(this.workspace.root, path); if (isAbsolute(local) || local === '..' || local.startsWith('../')) throw Error('LSP URI is outside the workspace');
        await this.workspace.path(local);
      } else await this.validateUris(item, depth + 1);
    }
  }
  request(method, {path, params = {}, options = {}}, signal) {
    if (!LanguageService.methods.has(method)) return Promise.reject(new AgentError('LSP_METHOD', 'Unsupported or side-effecting LSP method'));
    const operation = this.queue.catch(() => {}).then(async () => {
      AgentError.abort(signal); const snapshot = await this.workspace.snapshot();
      if (path) params = {...params, textDocument: {uri: pathToFileURL(await this.workspace.path(path)).href}};
      await this.validateUris(params);
      await this.session.synchronize(snapshot, {features: options.features ?? [], allFeatures: options.allFeatures === true, defaultFeatures: options.defaultFeatures !== false, expandNativeMacros: options.expandNativeMacros === true}, signal);
      if (this.peer !== this.session.peer) {
        this.peer = this.session.peer; const previous = this.peer.onNotification;
        this.peer.onNotification = (method, params) => {
          previous(method, params);
          if (method === 'textDocument/publishDiagnostics') { this.diagnostics.set(params.uri, params.diagnostics); this.events.emit('language.diagnostics', params); }
        };
      }
      await this.session.ready(signal);
      const result = await this.session.peer.request(method, params, {signal, timeoutMs: 30000});
      return {backend: 'rust-analyzer', method, result, capabilities: this.session.capabilities?.capabilities};
    });
    this.queue = operation; return operation;
  }
  async close() { await this.session.dispose(); await this.queue.catch(() => {}); }
}
