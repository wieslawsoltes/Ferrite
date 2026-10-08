import {CargoTimingReport} from './CargoTimingReport.js';
import {RepositoryLanguageProject} from './RepositoryLanguageProject.js';
import {RustAnalyzerSession} from '../lsp/RustAnalyzerSession.js';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {RepositoryPolicy as P} from './RepositoryPolicy.js';
import {RepositorySession} from './RepositorySession.js';
import {NativeCargoRunner} from '../NativeCargoRunner.js';
import {ProcessRunner} from '../ProcessRunner.js';
import {BuildJobBudget} from '../BuildJobBudget.js';

/** Native repository lifetime and per-workspace serialization; builds reuse real Cargo caches. */
export class RepositoryManager {
  constructor({allowedRoots = [], maxSessions = 4, jobs, processRunner = new ProcessRunner(), runnerFactory = options => new NativeCargoRunner(options)} = {}) {
    this.allowedRoots = allowedRoots.map(path => resolve(path)); this.maxSessions = maxSessions;
    this.sessions = new Map(); this.opening = 0; this.reservedRoots = new Set(); this.process = processRunner;
    this.runnerFactory = runnerFactory; this.budget = new BuildJobBudget(jobs); this.closed = false;
  }
  get(id, version) {
    const session = this.sessions.get(id);
    if (!session) throw Error('Repository session expired or unknown; reopen the repository');
    if (version !== undefined && version !== session.version) throw Error('Stale repository revision; reload before changing files');
    return session;
  }
  async list() { return [...this.sessions.values()].map(({id,root,source,owned,head,version,busy}) => ({id,root,source,owned,head,version,busy})); }
  async exclusive(id, version, operation) {
    const session = this.get(id, version);
    if (session.busy) throw Error('This repository has a running operation');
    session.busy = true;
    try { return await operation(session); } finally { session.busy = false; }
  }
  async git(args, {cwd, signal, onEvent} = {}) {
    const settings = ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
      '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', '-c', 'protocol.allow=never',
      '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always'];
    const result = await this.process.run('git', [...settings, ...args], {cwd, signal, onEvent, timeoutMs: 600000,
      env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=yes'}});
    if (result.exitCode !== 0) throw Error(`Git exited ${result.exitCode}: ${result.stderr.slice(-3000)}`);
    return result.stdout.trim();
  }
  async metadata(session, signal) {
    const result = await this.process.run('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', session.manifest],
      {cwd: session.root, signal, timeoutMs: 120000});
    if (result.exitCode !== 0) { session.metadata = null; session.metadataError = result.stderr.slice(-3000); return; }
    session.metadata = JSON.parse(result.stdout); session.metadataError = null;
  }
  async open(input, {signal, onEvent} = {}) {
    if (this.closed) throw Error('Repository manager is closed');
    if (input?.trust !== true) throw Error('Explicit project trust is required for native repository access');
    if (this.sessions.size + this.opening >= this.maxSessions) throw Error('Close a repository session before opening another');
    const manifest = P.path(input.manifest || 'Cargo.toml');
    if (P.ignored(manifest) || !manifest.endsWith('Cargo.toml')) throw Error('Select a Cargo.toml manifest');
    let root, owned = false, session, reserved = false;
    this.opening++;
    try {
      if (input.kind === 'local') root = await P.local(input.path, this.allowedRoots);
      else if (input.kind === 'remote') {
        const url = P.remote(input.url), ref = P.ref(input.ref);
        root = await mkdtemp(join(tmpdir(), 'ferrite-repository-')); owned = true;
        await this.git(['clone', '--no-checkout', '--no-local', '--no-hardlinks', '--no-recurse-submodules', '--template=', '--', url, root], {signal, onEvent});
        let target = 'HEAD';
        if (ref) { await this.git(['fetch', '--no-tags', 'origin', ref], {cwd: root, signal, onEvent}); target = 'FETCH_HEAD'; }
        const head = await this.git(['rev-parse', '--verify', target + '^{commit}'], {cwd: root, signal});
        if (!/^[a-f0-9]{40,64}$/.test(head)) throw Error('Git did not return a valid commit');
        await this.git(['checkout', '--detach', head, '--'], {cwd: root, signal, onEvent});
        if (input.submodules === true) await this.git(['submodule', 'update', '--init', '--recursive', '--checkout', '--jobs', String(this.budget.capacity)], {cwd: root, signal, onEvent});
      } else throw Error('Select local or remote repository');
      const existing = [...this.sessions.values()].find(s => s.root === root);
      if (existing && !existing.busy) return existing.describe();
      if (existing || this.reservedRoots.has(root)) throw Error('This local directory is already being opened or used');
      this.reservedRoots.add(root); reserved = true;
      session = new RepositorySession({root, owned, source: input.kind === 'remote' ? P.remote(input.url) : root, manifest});
      try { session.head = await this.git(['rev-parse', '--verify', 'HEAD'], {cwd: root, signal}); }
      catch { signal?.throwIfAborted(); /* Plain local Cargo directories are supported too. */ }
      await session.language?.dispose(); session.language = null;
      await session.refresh(signal);
      try { await this.metadata(session, signal); } catch (error) { signal?.throwIfAborted(); session.metadataError = error.message; }
      signal?.throwIfAborted();
      session.runner = this.runnerFactory({project: session});
      this.sessions.set(session.id, session);
      return session.describe();
    } catch (error) { if (owned && root) await rm(root, {recursive: true, force: true}); throw error; }
    finally { if (reserved) this.reservedRoots.delete(root); this.opening--; }
  }
  async run(input, options = {}) {
    return this.exclusive(input.id, input.version, async session => {
      const {signal, onEvent} = options;
      const jobs = this.budget.jobs(input.jobs);
      onEvent?.({kind: 'status', text: `Waiting for ${jobs} of ${this.budget.capacity} native build slots…\n`});
      const lease = await this.budget.acquire(jobs, signal);
      try {
        onEvent?.({kind: 'status', text: `Cargo job budget: ${lease.jobs}. Workspace: ${session.manifest}\n`});
        const manifestsChanged = Object.entries(input.files??{}).some(([path,text])=>path.endsWith('Cargo.toml')&&session.previous.get(path)!==text);
        const previousTiming = input.args?.includes('--timings') ? await CargoTimingReport.fingerprint(session) : null;
        const result = await session.runner.run({files: input.files}, input.command, {...options, args: input.args ?? [],
          json: input.json === true, offline: input.offline === true, locked: input.locked === true,
          toolchain: input.toolchain ?? '', jobs: lease.jobs, manifest: session.manifest, interactive: true});
        // Capture generated/modified manifests and lockfiles even when Cargo reports failure.
        await session.refresh();
        if (manifestsChanged || ['add', 'remove', 'metadata'].includes(input.command)) try { await this.metadata(session, signal); }
        catch (error) { session.metadataError = error.message; }
        return {...result, timingReport: input.args?.includes('--timings') ? await CargoTimingReport.read(session, previousTiming) : null, repository: session.describe(), buildSummary: {
          jobs: lease.jobs, fresh: result.artifacts.filter(a => a.fresh).length,
          rebuilt: result.artifacts.filter(a => !a.fresh).length, elapsedMs: result.elapsedMs,
          scheduling: 'cargo-dependency-graph', quality: 'unchanged rustc checks and selected Cargo profile'
        }};
      } finally { lease.release(); }
    });
  }
  async refresh(input, {signal} = {}) {
    return this.exclusive(input.id, input.version, async session => {
      if (input.manifest) {
        P.path(input.manifest);
        if (!input.manifest.endsWith('Cargo.toml') || P.ignored(input.manifest)) throw Error('Invalid Cargo manifest');
        await P.read(session.root, input.manifest);
        session.manifest = input.manifest;
      }
      await session.language?.dispose(); session.language = null;
      await session.refresh(signal);
      try { await this.metadata(session, signal); } catch (error) { signal?.throwIfAborted(); session.metadataError = error.message; }
      return session.describe();
    });
  }
  async language(input, {signal} = {}) {
    return this.exclusive(input.id, input.version, async session => {
      session.language ??= new RustAnalyzerSession({project: new RepositoryLanguageProject(session)});
      return session.language.request({files: input.files}, input.method, {file: input.file, position: input.position, newName: input.newName, options: input.options ?? {}, signal});
    });
  }
  input(id, text) {
    const session = this.get(id);
    if (!session.runner.input) throw Error('No native process is accepting input');
    session.runner.input(text);
  }
  async close(id) {
    return this.exclusive(id, undefined, async session => {
      await session.language?.dispose(); await session.runner.dispose(); await session.dispose(); this.sessions.delete(id); return {closed: true};
    });
  }
  async dispose() { this.closed = true; await Promise.all([...this.sessions.keys()].map(id => this.close(id))); }
}
