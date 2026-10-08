#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeCargoRunner} from '../src/native/NativeCargoRunner.js';
import {ProjectMaterializer} from '../src/native/ProjectMaterializer.js';
export const commands = NativeCargoRunner.commands;
export const validateSnapshot = value => ProjectMaterializer.validate(value);
export async function materialize(snapshot) { return (await ProjectMaterializer.create(snapshot)).root; }
export async function runCargo(snapshot, command = 'check', options = {}) {
  const runner = new NativeCargoRunner(options);
  try { return await runner.run(snapshot, command, options); } finally { await runner.dispose(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), separator = argv.indexOf('--'), flags = separator < 0 ? argv : argv.slice(0, separator);
  const option = name => { const i = flags.indexOf(name); return i < 0 ? null : flags[i + 1]; };
  const snapshotPath = option('--snapshot'), command = option('--command') ?? 'check';
  if (!snapshotPath) {
    console.error('Usage: node tools/cargo-native.mjs --snapshot project.ferrite.json --command build [--output-dir out] [--trust-project] -- [Cargo flags]');
    console.error('Native Cargo/build scripts execute with your user permissions. Only use trusted projects.'); process.exitCode = 2;
  } else if (!flags.includes('--trust-project')) { console.error('Native execution requires --trust-project. Review dependencies and build scripts first.'); process.exitCode = 2; }
  else {
    const controller = new AbortController(); process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
    try {
      const result = await runCargo(JSON.parse(await readFile(snapshotPath, 'utf8')), command, {
        args: separator < 0 ? [] : argv.slice(separator + 1), signal: controller.signal, outputDir: option('--output-dir'),
        timeoutMs: Number(option('--timeout-ms') ?? 120000), onEvent: e => process[e.kind].write(e.text)
      });
      process.exitCode = result.exitCode;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
