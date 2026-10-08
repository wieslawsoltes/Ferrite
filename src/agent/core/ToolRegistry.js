import {AgentError} from './AgentError.js';
import {JsonSchema} from './JsonSchema.js';

/** Single executable contract for MCP, built-in agents and the IDE tool explorer. */
export class ToolRegistry {
  constructor({approvals, events, artifacts} = {}) { this.tools = new Map(); this.approvals = approvals; this.events = events; this.artifacts = artifacts; }
  register(definition) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(definition.name) || this.tools.has(definition.name)) throw Error('Invalid or duplicate tool name');
    if (!definition.description || typeof definition.run !== 'function') throw Error('Tool requires description and implementation');
    this.tools.set(definition.name, {...definition, risk: definition.risk ?? 'read'}); return this;
  }
  get(name) { const tool = this.tools.get(name); if (!tool) throw new AgentError('UNKNOWN_TOOL', `Unknown tool: ${name}`, {status: 404}); return tool; }
  list() {
    return [...this.tools.values()].map(tool => ({name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
      annotations: {readOnlyHint: tool.risk === 'read', destructiveHint: tool.risk !== 'read' && tool.risk !== 'plan', openWorldHint: tool.risk === 'execute', idempotentHint: tool.risk === 'read'},
      risk: typeof tool.risk === 'string' ? tool.risk : 'conditional', category: tool.category ?? 'workspace'}));
  }
  async execute(name, args = {}, context = {}) {
    const tool = this.get(name); JsonSchema.validate(args, tool.inputSchema); AgentError.abort(context.signal);
    const preview = tool.preview ? await tool.preview(args, context) : undefined;
    await this.approvals?.authorize(tool, args, context, preview); AgentError.abort(context.signal);
    const start = performance.now(); this.events?.emit('tool.started', {sessionId: context.sessionId, callId: context.callId, name, arguments: args});
    try {
      const result = await tool.run(args, context);
      const text = JSON.stringify(result ?? null); let value = result ?? null;
      if (text.length > 24000 && this.artifacts) {
        const artifact = await this.artifacts.put(text);
        value = {truncated: true, artifact, characters: text.length, preview: text.slice(0, 16000), instruction: 'Use artifact_read with offsets to retrieve the complete result.'};
      }
      this.events?.emit('tool.completed', {sessionId: context.sessionId, callId: context.callId, name, elapsedMs: performance.now() - start, result: value});
      return value;
    } catch (error) {
      this.events?.emit('tool.failed', {sessionId: context.sessionId, callId: context.callId, name, elapsedMs: performance.now() - start, error: {code: error.code ?? 'TOOL_ERROR', message: error.message}});
      throw error;
    }
  }
}
