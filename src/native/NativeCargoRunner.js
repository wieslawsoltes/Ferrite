import {cp, mkdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {ProcessRunner} from './ProcessRunner.js';
import {ProjectMaterializer} from './ProjectMaterializer.js';
import {CargoOutputParser} from './CargoOutputParser.js';

/** Delegates native Rust semantics to installed Cargo; it does not emulate Cargo. */
export class NativeCargoRunner {
  static commands = new Set(['check', 'build', 'run', 'test', 'metadata', 'tree', 'fetch', 'clean', 'doc', 'clippy', 'fmt', 'bench', 'rustc', 'rustdoc', 'locate-project', 'verify-project', 'generate-lockfile', 'update', 'package']);
  constructor(options = {}) { this.process = new ProcessRunner(options); this.project = null; this.busy = false; }
  async run(snapshot, command = 'check', {args = [], timeoutMs = 120000, signal, onEvent, outputDir = null, json = false, offline = false, locked = false} = {}) {
    if (!NativeCargoRunner.commands.has(command)) throw Error(`Unsupported Cargo command ${command}; publishing and credential commands are intentionally not exposed`);
    if (this.busy) throw Error('A native Cargo command is already running');
    if (!Array.isArray(args) || args.length > 200 || args.some(a => typeof a !== 'string' || a.length > 4096 || a.includes('\0'))) throw Error('Invalid Cargo arguments');
    this.busy = true;
    try {
      if (this.project) await this.project.update(snapshot); else this.project = await ProjectMaterializer.create(snapshot);
      const argv = [command];
      if (command === 'metadata' && !args.includes('--format-version')) argv.push('--format-version', '1');
      if (json && ['check', 'build', 'test', 'run', 'clippy', 'bench'].includes(command) && !args.some(a => a.startsWith('--message-format'))) argv.push('--message-format=json');
      if (offline) argv.push('--offline'); if (locked) argv.push('--locked'); argv.push(...args);
      const start = performance.now();
      const result = await this.process.run('cargo', argv, {cwd: this.project.root, signal, timeoutMs, onEvent});
      if (outputDir && result.exitCode === 0 && command === 'build') { const output = resolve(outputDir); await mkdir(output, {recursive: true}); await cp(join(this.project.root, 'target'), output, {recursive: true}); }
      return {...result, command, args: argv, elapsedMs: performance.now() - start, backend: 'native-cargo', ...CargoOutputParser.parse(result.stdout), files: await this.project.outputFiles()};
    } finally { this.busy = false; }
  }
  async dispose() { if (this.busy) throw Error('Cannot dispose a running Cargo project; cancel and await it first'); await this.project?.dispose(); this.project = null; }
}
