#!/usr/bin/env node
/** Explicit, shell-free native Cargo build + single HTML packaging. Never called implicitly. */
import {writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeCargoRunner} from '../src/native/NativeCargoRunner.js';
import {exportNativeHTML} from '../src/ui-framework/NativeWasm.js';
const args = process.argv.slice(2);
if (!args.includes('--trust-projects')) throw Error('Cargo executes dependencies/build scripts. Pass --trust-projects only for trusted source.');
const get = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i+1] || args[i+1].startsWith('--')) throw Error(`${name} requires a value`); return args[i+1]; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = resolve(get('--manifest', resolve(root,'rust-ui/Cargo.toml'))), target = get('--package', 'ferrite-ui-example');
if (!/^[a-zA-Z0-9_-]+$/.test(target)) throw Error('Invalid Cargo package');
const runner = new NativeCargoRunner({project: {root: dirname(manifest), async update() {}, async outputFiles() { return {}; }}});
try {
  const result = await runner.run({files:{}}, 'ui-build', {manifest: basename(manifest), args:['-p',target,'--release'], offline: args.includes('--offline'), onEvent:event=>process.stderr.write(event.text??'')});
  if (result.exitCode !== 0) throw Error(`Cargo UI build failed (${result.exitCode})`);
  const artifact = result.compilerArtifacts.find(a=>a.kind==='native-ui-wasm');
  if (!artifact) throw Error('No native UI cdylib produced');
  const output = resolve(get('--output', resolve(root,'artifacts/native-ui/app.html'))); await mkdir(dirname(output), {recursive:true});
  const bytes=Uint8Array.from(Buffer.from(artifact.content,'base64'));
  await writeFile(output,exportNativeHTML(bytes,{title:target}));
  await writeFile(output.replace(/\.html$/i,'')+'.wasm',bytes);
  console.log(JSON.stringify({output, wasmBytes:bytes.length,backend:'native-rustc-wasm',package:target}));
} finally { await runner.dispose(); }
