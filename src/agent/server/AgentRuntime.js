import {createHash} from 'node:crypto';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {EventLog} from '../core/EventLog.js';
import {ApprovalGate} from '../core/ApprovalGate.js';
import {ToolRegistry} from '../core/ToolRegistry.js';
import {AgentHarness} from '../core/AgentHarness.js';
import {ProviderRegistry} from '../providers/ProviderRegistry.js';
import {PrivateStore} from './PrivateStore.js';
import {StateLease} from './StateLease.js';
import {NativeWorkspace} from './NativeWorkspace.js';
import {CompilerService} from './CompilerService.js';
import {LanguageService} from './LanguageService.js';
import {IdeChannel} from './IdeChannel.js';
import {TerminalManager} from '../terminal/TerminalManager.js';
import {registerWorkspaceTools} from '../tools/WorkspaceTools.js';
import {registerProcessTools} from '../tools/ProcessTools.js';
import {registerCompilerTools, IDE_COMMANDS} from '../tools/CompilerTools.js';
import {registerAgentTools} from '../tools/AgentTools.js';

/** Shared composition root for local HTTP, MCP and the headless agent CLI. */
export class AgentRuntime {
  static async create({root, state, providers, processOptions = {}, terminalOptions = {}, ...options} = {}) {
    if (!root) throw Error('Select an explicit workspace root');
    const events = new EventLog({limit: 4000, maxCharacters: 4_000_000}), workspace = await new NativeWorkspace(root, {events}).initialize();
    const stateRoot = resolve(state ?? join(homedir(), '.local/state/ferrite', createHash('sha256').update(workspace.root).digest('hex').slice(0, 24)));
    const inside = relative(workspace.root, stateRoot);
    if (!inside || inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\') && !isAbsolute(inside)) throw Error('Agent state must be stored outside the source workspace');
    const store = await new PrivateStore(stateRoot).initialize(); workspace.store = store;
    const lease = await StateLease.acquire(stateRoot);
    const runtime = new AgentRuntime(); Object.assign(runtime, {events, workspace, store, lease});
    try {
    runtime.providers = providers ?? new ProviderRegistry(options);
    // Redact configured API keys before data reaches any observer or persistent tool artifact.
    const emit = events.emit.bind(events); events.emit = (type, data) => emit(type, JSON.parse(runtime.providers.redact(JSON.stringify(data ?? {}))));
    const put = store.put.bind(store); store.put = text => put(runtime.providers.redact(text));
    runtime.approvals = new ApprovalGate(events); runtime.tools = new ToolRegistry({events, approvals: runtime.approvals, artifacts: store, sanitize: value => JSON.parse(runtime.providers.redact(JSON.stringify(value ?? null)))});
    runtime.compiler = new CompilerService(); runtime.language = new LanguageService(workspace, events); runtime.ide = new IdeChannel(events); runtime.terminals = new TerminalManager(workspace, events, terminalOptions);
    registerWorkspaceTools(runtime.tools, workspace, store);
    registerProcessTools(runtime.tools, workspace, events, runtime.terminals, processOptions);
    registerCompilerTools(runtime.tools, runtime);
    runtime.harness = new AgentHarness({providers: runtime.providers, tools: runtime.tools, store, events, onCancel: id => runtime.terminals.closeOwner(id), instructions: async () => (await workspace.text('AGENTS.md', {optional: true}))?.slice(0, 32000) ?? ''});
    registerAgentTools(runtime.tools, runtime); return runtime;
    } catch (error) { await runtime.close(); throw error; }
  }
  capabilities() { return {name: 'Ferrite Agent Workbench', version: '0.7.0', workspace: this.workspace.root, nativeExecution: 'trusted-host-not-sandboxed', terminal: process.platform === 'win32' ? 'use-wsl' : 'posix-python-pty', providers: this.providers.list(), tools: this.tools.list(), ideCommands: IDE_COMMANDS, languageMethods: [...LanguageService.methods], mcpVersions: ['2026-07-28', '2025-11-25']}; }
  close() { return this.closing ??= (async () => {
    this.approvals?.close(); this.ide?.close();
    try { await this.harness?.close(); }
    finally { await Promise.allSettled([this.terminals?.dispose(), this.language?.close(), this.compiler?.close()]); await this.lease?.release(); }
  })(); }
}
