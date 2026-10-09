import {registerUITools, UI_IDE_COMMANDS} from './UITools.js';
import {object, text, path, integer} from './ToolSchemas.js';
import {RUST_LANGUAGE_METHODS} from '../core/LanguageMethods.js';
import {AgentError} from '../core/AgentError.js';

export const IDE_COMMANDS = [...UI_IDE_COMMANDS, 'editor.open', 'editor.select', 'editor.state', 'panel.open', 'panel.move', 'panel.float', 'layout.reset', 'compiler.check', 'compiler.build', 'compiler.run', 'compiler.test', 'compiler.debug', 'compiler.stop', 'visualizer.stage', 'visualizer.instance', 'debug.step', 'debug.step-line', 'debug.back', 'debug.back-line', 'debug.continue', 'debug.pause', 'debug.breakpoints', 'search.query'];
export function registerCompilerTools(registry, {workspace, compiler, language, ide}) {
  registerUITools(registry, {workspace, compiler, language, ide});
  const options = {type: 'object', properties: {features: {type: 'array', items: text(200), maxItems: 100}, allFeatures: {type: 'boolean'}, defaultFeatures: {type: 'boolean'}, optimize: {type: 'boolean'}, expandNativeMacros: {type: 'boolean'}}, additionalProperties: false};
  registry.register({name: 'compiler_analyze', category: 'compiler', risk: 'read', description: 'Compile the workspace with Ferrite’s browser-compatible Rust subset in an isolated worker. Return diagnostics, target, timings and all available stage names. This does not invoke rustc and is not full Rust compatibility. Full Rust requires the optional installed native toolchain, not the browser cargo/analysis adapters.',
    inputSchema: object({options}, []), run: async ({options = {}}, context) => {
      const snapshot = await workspace.snapshot(), build = await compiler.compile(snapshot.files, 'check', options, context.signal);
      return {backend: 'ferrite', hashes: snapshot.hashes, diagnostics: build.diagnostics, stages: build.stages.map(({name, kind}) => ({name, kind})), entry: build.entry, timings: build.timings, tests: build.tests};
    }});
  registry.register({name: 'compiler_inspect', category: 'compiler', risk: 'read', description: 'Inspect actual stage data by exact name returned by compiler_analyze: tokens, AST, typed HIR, symbols, traits/types, ownership, patterns, closures, generic instances, MIR/CFG, optimized MIR, call graph, incremental queries, WebAssembly or generated JavaScript. Optional instance filters MIR functions.',
    inputSchema: object({stage: text(100), instance: text(500), options}, ['stage']), run: async ({stage, instance, options = {}}, context) => {
      const snapshot = await workspace.snapshot(), build = await compiler.compile(snapshot.files, 'check', options, context.signal), value = build.stages.find(item => item.name === stage);
      if (!value) throw new AgentError('UNKNOWN_STAGE', `Unknown stage; available: ${build.stages.map(item => item.name).join(', ')}`);
      return {...value, data: instance && Array.isArray(value.data) ? value.data.filter(item => item.instance === instance || item.key === instance) : value.data, hashes: snapshot.hashes, diagnostics: build.diagnostics};
    }});
  registry.register({name: 'compiler_execute', category: 'compiler', risk: 'execute', description: 'Run Ferrite MIR or its supported tests in a bounded worker, without evaluating generated JavaScript in the bridge. Unsupported Rust requires native Cargo. Step/output/time budgets are enforced.',
    inputSchema: object({mode: {enum: ['run', 'test']}, options}, []), run: async ({mode = 'run', options = {}}, context) => {
      const snapshot = await workspace.snapshot(); return compiler.compile(snapshot.files, 'agent-' + mode, options, context.signal);
    }});
  registry.register({name: 'rust_language', category: 'rust', risk: language?.risk ?? 'execute', description: language?.description ?? 'Request real rust-analyzer LSP analysis on the persistent checkout. Supports completion/resolve, hover, navigation, references, symbols, rename previews, formatting, code actions, inlay hints, semantic tokens, call/type hierarchy and Rust syntax/HIR/MIR/macro views. path supplies textDocument.uri; params are standard UTF-16 LSP arguments (zero-based). Results are not applied automatically. Requires installed rust-analyzer/rust-src. Native loading/build scripts are trusted execution, never a sandbox.',
    inputSchema: object({method: {enum: [...(language?.methods ?? RUST_LANGUAGE_METHODS)]}, path, params: {type: 'object'}, options}, ['method']), run: ({method, ...args}, context) => language.request(method, args, context.signal)});
  registry.register({name: 'ide_inspect', category: 'ide', risk: 'read', description: 'Read the connected IDE’s active file, selection, revision, open tabs, backend, available compiler stages and debugger state. No connection is invented.', inputSchema: object(), run: () => ide.inspect()});
  registry.register({name: 'ide_command', category: 'ide', risk: args => /^(?:compiler\.(?:check|build|run|test|debug)|debug\.|ui\.(?:native\.preview|preview|debug|state\.set))/.test(args.command) ? 'execute' : 'read', description: 'Control the connected IDE through its command bus. Supply expectedRevision for source-dependent commands to avoid acting on stale editor state. Commands select files/ranges, expose compiler visualizers, control browser MIR debugging, manage docking and search. No arbitrary JavaScript is accepted.',
    inputSchema: object({command: {enum: IDE_COMMANDS}, arguments: {type: 'object'}, expectedRevision: integer(0, Number.MAX_SAFE_INTEGER)}, ['command']), run: ({command, arguments: args = {}, expectedRevision}, context) => ide.request(command, {...args, expectedRevision}, context)});
}
