import type {ServerRenderOptions} from '../ui-framework/ServerRenderer.js';
import type {RuntimeAPI, Root} from '../ui-framework/React.js';
export type JsonValue = null | boolean | number | string | JsonValue[] | {[name: string]: JsonValue};
export type Backend = 'mir' | 'wasm' | 'javascript';
export interface SourceSpan { file: string; start: number; end: number; line: number; column: number; endLine?: number; endColumn?: number }
export interface Diagnostic { code: string; message: string; severity?: 'error' | 'warning'; span?: SourceSpan; notes?: string[] }
export interface MirFunction { instance: string; blocks: unknown[]; registers: unknown[]; params: unknown[]; returnType: string; span?: SourceSpan }
export interface RustArtifact {
  version: string; entry: string | null; js: string; wasm: {bytes: number[]; [name: string]: unknown};
  mir: MirFunction[]; optimizedMir: MirFunction[]; diagnostics: Diagnostic[]; timings: {name: string; ms: number}[];
  verification: unknown; ast: unknown; tokens: unknown[]; sem: unknown; [stage: string]: unknown;
}
export interface UIAttribute { name: string; kind: 'string' | 'expression' | 'boolean'; value?: string | boolean; start: number; end: number }
export interface UINode { id: string; kind: 'element' | 'text' | 'expression'; span: SourceSpan; start: number; end: number; tag?: string | null; value?: string; attributes?: UIAttribute[]; children?: UINode[] }
export interface UIArtifact {
  format: 'ferrite-ui-v1'; abi: 1; source: string; file: string; entry: string; maxSteps: number;
  nodes: UINode[]; mir: MirFunction[]; optimizedMir: MirFunction[]; js: string; wasm: {bytes: number[]; [name: string]: unknown};
  diagnostics: Diagnostic[]; verification: unknown; timings: {name: string; ms: number}[]; [stage: string]: unknown;
}
export interface CompileOptions { file?: string; entry?: string; optimize?: boolean; now?: () => number; configuration?: Record<string, unknown>; runtime?: Record<string, unknown> }
export interface UICompileOptions extends CompileOptions { maxSteps?: number; files?: Record<string, string>; entryProps?: boolean }
export interface UIOptions extends Omit<UICompileOptions, 'runtime'> { backend?: Backend; runtime?: RuntimeAPI; maxHandles?: number; maxTrace?: number; onError?: (error: Error & Partial<Diagnostic>) => void; hydrate?: boolean; identifierPrefix?: string; onRecoverableError?: (error: Error) => void; props?: unknown; onEvent?: (name: string, value: JsonValue) => void; components?: Record<string, unknown> }
export interface ExportOptions { backend?: Backend; title?: string; css?: string; channel?: string | null; hydrate?: boolean; identifierPrefix?: string; props?: unknown }
export interface UIState { handle: number; type: string; value: JsonValue }
export interface UISnapshot { states: UIState[]; calls: number; handles: number; debugger: Record<string, unknown>; [name: string]: unknown }
export function compileRust(source: string, options?: CompileOptions): RustArtifact;
export function compileUI(source: string, options?: UICompileOptions): UIArtifact;
/** Compiled artifacts contain executable JavaScript; accept only trusted artifacts. */
export function mountUI(sourceOrArtifact: string | UIArtifact, container: Element, options?: UIOptions): UISession;
export function runRust(sourceOrArtifact: string | RustArtifact, options?: {backend?: Backend; entry?: string; args?: unknown[]; maxSteps?: number; maxTrace?: number; maxDepth?: number} & CompileOptions): {value: unknown; output: string; steps: number; debugger?: unknown};
export function exportHTML(artifact: UIArtifact, options?: ExportOptions): string;
export {renderToString, renderToStaticMarkup, renderUIToString, exportHydratedHTML} from '../ui-framework/ServerRenderer.js';
import {renderToString, renderToStaticMarkup, renderUIToString, exportHydratedHTML} from '../ui-framework/ServerRenderer.js';
export function runScripts(options?: {document?: Document; root?: ParentNode; backend?: Backend; onError?: (error: Error, script: HTMLScriptElement) => void}): {script: HTMLScriptElement; result?: UISession | ReturnType<typeof runRust>; error?: Error}[];
export const UI: RuntimeAPI;
export function createUIRuntime(): RuntimeAPI;
export class UICompiler { static compile(source: string, options?: UICompileOptions): UIArtifact }
export class UISession {
  constructor(artifact: UIArtifact, options?: UIOptions);
  readonly artifact: UIArtifact; readonly backend: Backend; readonly root: Root | null; readonly disposed: boolean;
  updateProps(props: unknown, bindings?: {onEvent?: (name: string, value: JsonValue) => void; components?: Record<string, unknown>}): this;
  mount(container: Element, options?: {hydrate?: boolean; identifierPrefix?: string; onRecoverableError?: (error: Error) => void}): this; inspect(): UISnapshot; inspectDebugger(): Record<string, unknown>;
  armDebugger(options?: {breakpoints?: {file: string; line: number}[]}): Record<string, unknown>;
  debug(command?: 'step' | 'step-line' | 'continue' | 'stop'): Record<string, unknown>;
  setState(handle: number, value: JsonValue): UISnapshot;
  subscribe(listener: (event: Record<string, unknown>) => void): () => void; dispose(): void;
}
export type DesignOperation = {node: string} & (
  {op: 'setAttribute'; name: string; value?: string; kind?: 'string' | 'expression' | 'boolean'} |
  {op: 'removeAttribute'; name: string} | {op: 'setText' | 'setTag'; value: string} |
  {op: 'insert'; markup: string; before?: string} | {op: 'remove' | 'duplicate'} | {op: 'move'; parent: string; before?: string} | {op: 'setLayout'; rectangle: CanvasRectangle; grid?: number; snap?: boolean}
);
export interface DesignSnapshot { file: string; entryFile: string; dependencies: string[]; entry: string; revision: number; source: string; canUndo: boolean; canRedo: boolean; nodes: (Omit<UINode, 'children'> & {parent: string | null; children?: string[]})[] }
export class SourceDesigner {
  constructor(source: string, options?: {file?: string; entry?: string; revision?: number; validate?: boolean; maxHistory?: number; files?: Record<string, string>; entryFile?: string});
  readonly source: string; readonly revision: number; readonly nodes: UINode[];
  snapshot(): DesignSnapshot; apply(operation: DesignOperation, expectedRevision: number): DesignSnapshot;
  undo(expectedRevision: number): DesignSnapshot; redo(expectedRevision: number): DesignSnapshot;
}
export const Ferrite: Readonly<{version: string; createReactAdapter: typeof createReactAdapter; compileRust: typeof compileRust; compileUI: typeof compileUI; mountUI: typeof mountUI; runRust: typeof runRust; runScripts: typeof runScripts; exportHTML: typeof exportHTML; UI: RuntimeAPI; createUIRuntime: typeof createUIRuntime; SourceDesigner: typeof SourceDesigner; UIProject: typeof UIProject; CanvasLayout: typeof CanvasLayout; renderToString: typeof renderToString; renderToStaticMarkup: typeof renderToStaticMarkup; renderUIToString: typeof renderUIToString; exportHydratedHTML: typeof exportHydratedHTML}>;

export interface CanvasRectangle { x: number; y: number; width: number; height: number }
export class CanvasLayout {
  static geometry(rectangle: CanvasRectangle, options?: {grid?: number; snap?: boolean}): CanvasRectangle;
  static style(css: string, rectangle: CanvasRectangle, options?: {grid?: number; snap?: boolean}): string;
  static declarations(css: string): {start: number; end: number; name: string}[];
}
export interface UIProjectSettings { version: 1; entryFile: string; entry: string; backend: Backend; stylesheet: string; viewport: '100%' | '375px' | '768px' | '1280px'; grid: number; snap: boolean }
export class UIProject {
  static manifestPath(file: string): string;
  static load(files: Record<string, string>, entryFile: string, options?: {css?: string}): UIProject;
  readonly manifest: string; readonly settings: Readonly<UIProjectSettings>; readonly css: string;
  changes(settings?: Partial<UIProjectSettings>, css?: string): Record<string, string>;
}

export interface RustReactHandle { inspect(): UISnapshot; setState(handle: number, value: JsonValue): UISnapshot; armDebugger(options?: {breakpoints?: {file: string; line: number}[]}): Record<string, unknown>; debug(command?: 'step' | 'step-line' | 'continue' | 'stop'): Record<string, unknown> }
export interface RustReactProps<T> { value?: T; onEvent?: (name: string, value: JsonValue) => void; components?: Record<string, unknown>; ref?: {current: RustReactHandle | null} | ((handle: RustReactHandle | null) => void) | null }
/** The return element type is inferred from the injected React installation. */
export function createReactAdapter<R extends {createElement: (...args: never[]) => unknown}>(dependencies: {React: R; ReactDOMClient?: object; ReactDOM?: object; ReactDOMServer?: object}): {
  readonly boundary: string;
  createComponent<T = JsonValue>(artifact: UIArtifact, options?: Omit<UIOptions, 'runtime'>): (props: RustReactProps<T>) => ReturnType<R['createElement']>;
  mount(artifact: UIArtifact, container: Element, options?: Omit<UIOptions, 'runtime'>): UISession;
  renderToString(node: ReturnType<R['createElement']>, options?: {identifierPrefix?: string}): string;
  renderToReadableStream(node: ReturnType<R['createElement']>, options?: Record<string, unknown>): Promise<ReadableStream<Uint8Array> & {allReady: Promise<void>}>;
  renderToPipeableStream(node: ReturnType<R['createElement']>, options?: Record<string, unknown>): {pipe(destination: unknown): unknown; abort(reason?: unknown): void};
};
