import {UI} from './Runtime.js';
export const Fragment = UI.Fragment;
export const jsx = UI.jsx;
export const jsxs = UI.jsxs;
// The development transform has extra location arguments; no React internals are used.
export function jsxDEV(type, props, key, _staticChildren, _source, _self) { return UI.jsx(type, props, key); }
