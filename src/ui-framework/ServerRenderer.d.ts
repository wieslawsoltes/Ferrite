import type {ReactNode, RuntimeAPI} from './React.js';
import type {UIArtifact, Backend, ExportOptions} from '../sdk/Ferrite.js';
export interface ServerRenderOptions { runtime?: RuntimeAPI; identifierPrefix?: string; maxNodes?: number; maxLength?: number; props?: unknown; components?: Record<string, unknown>; staticMarkup?: boolean }
/** Executes function components without effects or DOM refs. Non-streaming. */
export function renderToString(node: ReactNode, options?: ServerRenderOptions): string;
export function renderToStaticMarkup(node: ReactNode, options?: ServerRenderOptions): string;
export function renderUIToString(artifact: UIArtifact, options?: Omit<ServerRenderOptions, 'runtime'> & {backend?: Backend}): string;
/** Executes Rust rendering now; the returned offline document hydrates its initial DOM. */
export function exportHydratedHTML(artifact: UIArtifact, options?: ExportOptions & {identifierPrefix?: string; maxLength?: number}): string;
