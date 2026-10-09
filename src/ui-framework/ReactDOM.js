/** DOM entry point sharing exactly one runtime with React.js and JSX adapters. */
import {UI} from './Runtime.js';
export const createRoot = UI.createRoot;
export const createPortal = UI.createPortal;
export const flushSync = UI.flushSync;
export const hydrateRoot = UI.hydrateRoot;
