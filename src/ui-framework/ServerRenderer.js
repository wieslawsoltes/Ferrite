import {exportHTML} from './Export.js';
import {UI} from './Runtime.js';
import {ServerDocument} from './ServerDocument.js';
import {UISession} from './UISession.js';

/** Executes component render functions, but not effects, DOM refs or events. */
export function renderToString(node, {runtime = UI, identifierPrefix = '', maxNodes = 20000, maxLength = 10000000, staticMarkup = false} = {}) {
  const document = new ServerDocument({maxNodes: Math.min(maxNodes * 3, 200000)}), container = document.createElement('div');
  const root = runtime.createRoot(container, {server: true, identifierPrefix, maxNodes, throwErrors: true, onError: () => {}});
  try { root.render(node); return document.serialize(container, {maxLength, staticMarkup}); }
  finally { root.unmount(); }
}
export function renderToStaticMarkup(node, options = {}) { return renderToString(node, {...options, staticMarkup: true}); }

/** Explicit execution API. Ordinary exportHTML remains a non-executing artifact serializer. */
export function renderUIToString(artifact, {backend = 'javascript', identifierPrefix = '', maxLength = 10000000, staticMarkup = false} = {}) {
  const document = new ServerDocument(), container = document.createElement('div');
  const session = new UISession(artifact, {backend, onError: () => {}});
  try { session.mount(container, {server: true, identifierPrefix}); return document.serialize(container, {maxLength, staticMarkup}); }
  finally { session.dispose(); }
}

/** Produces initial HTML and an offline hydration program. This executes Rust now. */
export function exportHydratedHTML(artifact, options = {}) {
  const markup = renderUIToString(artifact, {...options, staticMarkup: false});
  const html = exportHTML(artifact, {...options, hydrate: true});
  return html.replace('<main id="app"></main>', () => `<main id="app">${markup}</main>`);
}
