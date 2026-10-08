import {CargoLogStream} from './CargoLogStream.js';
import {NativeArtifactCollector} from './NativeArtifactCollector.js';
import {cp, mkdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {ProcessRunner} from './ProcessRunner.js';
import {ProjectMaterializer} from './ProjectMaterializer.js';
import {CargoOutputParser} from './CargoOutputParser.js';

/** Delegates native Rust semantics to installed Cargo; it does not emulate Cargo. */
export class NativeCargoRunner {
  static commands = new Set(['inspect', 'check', 'build', 'run', 'test', 'metadata', 'tree', 'fetch', 'clean', 'doc', 'clippy', 'fmt', 'bench', 'rustc', 'rustdoc', 'locate-project', 'verify-project', 'generate-lockfile', 'update', 'package', 'add', 'remove', 'vendor', 'report']);
  constructor({project = null, ...options} = {}) { this.process = new ProcessRunner(options); this.project = project; this.ownsProject = !project; this.busy = false; this.input = null; }
  async run(snapshot, command = 'check', {args = [], timeoutMs = 120000, signal, onEvent, outputDir = null, json = false, offline = false, locked = false, jobs = null, toolchain = '', manifest = null, interactive = false} = {}) {
    if (!NativeCargoRunner.commands.has(command)) throw Error(`Unsupported Cargo command ${command}; publishing and credential commands are intentionally not exposed`);
    if (this.busy) throw Error('A native Cargo command is already running');
    if (!Array.isArray(args) || args.length > 200 || args.some(a => typeof a !== 'string' || a.length > 4096 || a.includes('\0'))) throw Error('Invalid Cargo arguments');
    if (jobs !== null && (!Number.isInteger(jobs) || jobs < 1 || jobs > 256)) throw Error('Cargo jobs must be 1..256');
    if (toolchain && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(toolchain)) throw Error('Invalid Rust toolchain');
    if (manifest) { const {RepositoryPolicy} = await import('./repository/RepositoryPolicy.js'); RepositoryPolicy.path(manifest); }
    if (jobs !== null && args.some(a => /^--jobs(?:=|$)|^-j/.test(a))) throw Error('Set jobs through the build job control, not extra arguments');
    this.busy = true;let collector=null;
    try {
      signal?.throwIfAborted();
      if (this.project) await this.project.update(snapshot); else this.project = await ProjectMaterializer.create(snapshot);
      if(command==='inspect')collector=await NativeArtifactCollector.create();
      const argv = [...(toolchain ? ['+' + toolchain] : []), command==='inspect'?'rustc':command];
      if (manifest) argv.push('--manifest-path', manifest);
      if (jobs !== null && ['check','build','run','test','clippy','bench','inspect','rustc','rustdoc','doc'].includes(command)) argv.push('--jobs', String(jobs));
      if (command === 'metadata' && !args.includes('--format-version')) argv.push('--format-version', '1');
      if (json && ['check', 'build', 'test', 'run', 'clippy', 'bench','inspect'].includes(command) && !args.some(a => a.startsWith('--message-format'))) argv.push('--message-format=json');
      if (command !== 'fmt') { if (offline) argv.push('--offline'); if (locked) argv.push('--locked'); } argv.push(...args);
      if(collector){if(!args.includes('--'))argv.push('--');argv.push(...collector.arguments());}
      const structuredOutput=argv.some((a,i)=>(a.startsWith('--message-format=')&&a.includes('json'))||(a==='--message-format'&&argv[i+1]?.includes('json')));
      const logs = new CargoLogStream(onEvent, structuredOutput);
      const start = performance.now();
      const result = await this.process.run('cargo', argv, {cwd: this.project.root, signal, timeoutMs, onEvent: event => logs.accept(event), onInput: interactive ? write => { this.input = write; } : null});
      logs.finish();
      if (outputDir && result.exitCode === 0 && command === 'build') { const output = resolve(outputDir); await mkdir(output, {recursive: true}); await cp(join(this.project.root, 'target'), output, {recursive: true}); }
      return {...result, programOutput:logs.programOutput, command, args: argv, elapsedMs: performance.now() - start, backend: 'native-cargo', sourceRoot: this.project.root, jobs, ...CargoOutputParser.parse(structuredOutput ? result.stdout : ''), compilerArtifacts:collector?await collector.collect(this.project.root,snapshot.files):[], files: await this.project.outputFiles()};
    } finally { try{await collector?.dispose();}finally{this.busy = false; this.input = null;} }
  }
  async dispose() { if (this.busy) throw Error('Cannot dispose a running Cargo project; cancel and await it first'); if (this.ownsProject) await this.project?.dispose(); this.project = null; }
}
