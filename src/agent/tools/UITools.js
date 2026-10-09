import {UIProject} from '../../ui-framework/UIProject.js';
import {object, text, path, integer, hash} from './ToolSchemas.js';
import {AgentError} from '../core/AgentError.js';
import {contentHash} from '../core/Platform.js';

export const UI_IDE_COMMANDS = ['ui.preview', 'ui.inspect', 'ui.select', 'ui.debug', 'ui.state.set'];
const entry = {...text(200), pattern: '^[A-Za-z_]\\w*(?:::[A-Za-z_]\\w*)*$'};
const backend = {enum: ['javascript', 'wasm', 'mir']};
export const UI_EDIT_SCHEMA = object({op: {enum: ['setAttribute', 'removeAttribute', 'setText', 'setTag', 'insert', 'remove', 'duplicate', 'move', 'setLayout']},
  node: text(2200), parent: text(2200), before: text(2200), name: text(80), value: text(64000), kind: {enum: ['string', 'expression', 'boolean']}, markup: text(64000), rectangle: object({x: {type: 'number', minimum: -1000000, maximum: 1000000}, y: {type: 'number', minimum: -1000000, maximum: 1000000}, width: {type: 'number', minimum: 1, maximum: 1000000}, height: {type: 'number', minimum: 1, maximum: 1000000}}, ['x', 'y', 'width', 'height']), grid: {type: 'number', minimum: 1, maximum: 256}, snap: {type: 'boolean'}}, ['op', 'node']);

/** Same definitions/approval gate for in-page MCP, native MCP and coding agents. */
export function registerUITools(registry, {workspace, compiler, ide}) {
  const add = (name, description, schema, risk, run, preview) => registry.register({name, description, inputSchema: schema, risk, category: 'ui', run, preview});
  const source = async file => {
    const snapshot = await workspace.snapshot();
    if (typeof snapshot.files[file] !== 'string') throw Error('UI source file not found or excluded by workspace policy');
    return snapshot.files;
  };
  add('ui_analyze', 'Compile a Rust UI file in the bounded compiler worker; return typed/source-mapped view! nodes, MIR verification, diagnostics and backend capabilities. Uses Ferrite’s documented Rust subset, not native rustc or full React compatibility.',
    object({path, entry}, ['path']), 'read', async ({path: file, entry}, context) => {
      const files = await source(file), result = await compiler.compile(files, 'ui-analyze', {file, entry}, context.signal);
      return {...result, hash: await contentHash(files[file])};
    });
  add('ui_export_html', 'Compile a UI file and return a complete offline HTML document with its runtime and selected backend embedded. No network assets or source execution in the MCP host. Large results use artifact_read.',
    object({path, entry, backend, title: text(1000), css: text(500000)}, ['path']), 'read', async ({path: file, ...options}, context) => {
      const files = await source(file), result = await compiler.compile(files, 'ui-export', {file, ...options}, context.signal);
      return {...result, hash: await contentHash(files[file])};
    });
  add('ui_render_html', 'Execute bounded Rust server rendering in the worker and produce an offline hydrated HTML document. Unlike ui_export_html, this runs render functions now and requires execution approval. Effects and DOM refs are not executed during server rendering.',
    object({path, entry, backend, title: text(1000), css: text(500000), identifierPrefix: text(200)}, ['path']), 'execute', async ({path: file, ...options}, context) => {
      const files = await source(file), result = await compiler.compile(files, 'ui-render', {file, ...options}, context.signal);
      return {...result, hash: await contentHash(files[file])};
    });
  const readProject = async file => {
    const files = await source(file), project = UIProject.load(files, file);
    return {project, files, hashes: {entry: await contentHash(files[file]), manifest: await contentHash(files[project.manifest] ?? null), stylesheet: await contentHash(files[project.settings.stylesheet] ?? null)}};
  };
  add('ui_project_inspect', 'Read persisted UI entry, backend, stylesheet, responsive viewport and canvas grid settings together with exact entry/manifest/stylesheet hashes. Missing sidecars return defaults without writing files.',
    object({path}, ['path']), 'read', async ({path: file}) => {
      const {project, hashes} = await readProject(file); return {manifest: project.manifest, settings: project.settings, css: project.css, hashes};
    });
  const prepareProject = async ({path: file, expectedHashes, settings = {}, css}) => {
    const {project, files, hashes} = await readProject(file);
    for (const key of ['entry', 'manifest', 'stylesheet']) if (hashes[key] !== expectedHashes[key]) throw new AgentError('EDIT_CONFLICT', 'UI project changed; inspect the new hashes');
    return [{path: file, expectedHash: hashes.entry, text: files[file]}, ...Object.entries(project.changes(settings, css ?? project.css)).map(([path, text]) => ({path, text, expectedHash: path === project.manifest ? hashes.manifest : hashes.stylesheet}))];
  };
  add('ui_project_set', 'Atomically persist UI project settings and CSS with exact three-file hash checks and a reversible workspace checkpoint. Does not run the application.',
    object({path, expectedHashes: object({entry: hash, manifest: hash, stylesheet: hash}, ['entry', 'manifest', 'stylesheet']),
      settings: object({entry, backend, viewport: {enum: ['100%', '375px', '768px', '1280px']}, grid: {type: 'number', minimum: 1, maximum: 256}, snap: {type: 'boolean'}}, []), css: text(500000)}, ['path', 'expectedHashes']), 'edit',
    async (args, context) => workspace.apply(await prepareProject(args), {sessionId: context.sessionId, signal: context.signal, label: 'Rust UI project settings'}),
    async args => workspace.preview(await prepareProject(args)));
  add('ui_design_inspect', 'Read source-backed visual nodes and exact UTF-16 source ranges without executing the application. Node IDs are valid only for the returned source hash.',
    object({path, entry, entryFile: path}, ['path']), 'read', async ({path: file, entry, entryFile}, context) => {
      const files = await source(file), result = await compiler.compile(files, 'ui-design', {file, entry, entryFile}, context.signal);
      return {...result, hash: await contentHash(files[file])};
    });
  const prepareEdit = async ({path: file, expectedHash, entry, entryFile, operation}, context = {}) => {
    const files = await source(file);
    if (await contentHash(files[file]) !== expectedHash) throw new AgentError('EDIT_CONFLICT', 'UI source changed; inspect its new hash and node IDs');
    const result = await compiler.compile(files, 'ui-design', {file, entry, entryFile, operation}, context.signal);
    const dependencies = (result.dependencies ?? []).filter(path => path !== file);
    if (dependencies.length >= 100) throw Error('Designer transactions support fewer than 100 reached modules');
    const guards = await Promise.all(dependencies.map(async path => ({path, expectedHash: await contentHash(files[path]), text: files[path]})));
    return [...guards, {path: file, expectedHash, text: result.source}];
  };
  add('ui_design_edit', 'Apply one atomic source-based visual edit: attribute, text, tag, insert, delete, duplicate, reparent or snapped canvas geometry. Requires the exact source hash. The complete edited Rust UI is type-checked before a reversible workspace checkpoint is committed. No regex rewriting or silent overwrite.',
    object({path, expectedHash: hash, entry, entryFile: path, operation: UI_EDIT_SCHEMA}, ['path', 'expectedHash', 'operation']), 'edit',
    async (args, context) => workspace.apply(await prepareEdit(args, context), {sessionId: context.sessionId, signal: context.signal, label: 'Rust UI visual edit'}),
    async (args, context) => workspace.preview(await prepareEdit(args, context)));
  add('ui_preview', 'Compile and mount the live editor UI in an opaque-origin sandbox. This executes bounded Rust/UI callbacks, requires execution approval, and requires a connected IDE; it never fabricates a browser session.',
    object({path, entry, backend, expectedRevision: integer(0, Number.MAX_SAFE_INTEGER)}, ['path']), 'execute',
    ({path: file, ...args}, context) => ide.request('ui.preview', {file, ...args}, context));
  add('ui_inspect', 'Inspect the connected, current UI preview’s component tree, state handles, commit timings and debugger. Stale previews are rejected.',
    object(), 'read', (_, context) => ide.request('ui.inspect', {}, context));
  add('ui_debug', 'Arm the next UI event callback, step MIR instructions/source lines, continue with breakpoints from the editor or disarm. Rendering/effects remain synchronous; paused events cannot cancel a past browser default.',
    object({action: {enum: ['arm', 'step', 'step-line', 'continue', 'stop']}, expectedRevision: integer(0, Number.MAX_SAFE_INTEGER)}, ['action']), 'execute',
    (args, context) => ide.request('ui.debug', args, context));
  add('ui_state_set', 'Set a live Rust state handle through the checked type boundary. Integers use decimal strings to avoid JSON precision loss. Owned records, arrays, tuples and enums are validated against compiler-generated schemas. Requires execution approval.',
    object({handle: integer(1, 0xffffffff), value: {type: ['string', 'boolean', 'number', 'array', 'object', 'null']}, expectedRevision: integer(0, Number.MAX_SAFE_INTEGER)}, ['handle', 'value']), 'execute',
    (args, context) => ide.request('ui.state.set', args, context));
}
