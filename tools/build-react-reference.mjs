import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require = createRequire(new URL('../tests/react-reference/package.json', import.meta.url));
const {build} = require('esbuild');
await mkdir(new URL('../artifacts/ui-react/', import.meta.url), {recursive: true});
await build({stdin: {contents: `export * as React from 'react'; export * as ReactDOMClient from 'react-dom/client'; export * as ReactDOM from 'react-dom'; export * as ReactDOMServer from 'react-dom/server.browser'; export * as Dialog from '@radix-ui/react-dialog';`, resolveDir: new URL('../tests/react-reference/', import.meta.url).pathname}, bundle: true, format: 'iife', globalName: 'FerriteReactReference', define: {'process.env.NODE_ENV': '"development"'}, outfile: new URL('../artifacts/ui-react/reference.bundle.js', import.meta.url).pathname});
