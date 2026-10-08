import {ApprovalGate} from '../core/ApprovalGate.js';
import {AgentError} from '../core/AgentError.js';

/** Browser permissions cannot grant host access and cannot override the read-only boundary. */
export class BrowserApprovalGate extends ApprovalGate {
  async authorize(tool, args, context, preview) {
    AgentError.abort(context.signal);
    const risk = typeof tool.risk === 'function' ? tool.risk(args) : tool.risk, rule = context.session?.config.toolRules?.[tool.name];
    try {
      if (context.mode === 'read-only' && !['read', 'plan'].includes(risk)) throw new AgentError('READ_ONLY', tool.name + ' is unavailable in read-only mode');
      if (rule === 'deny') throw new AgentError('TOOL_DENIED', tool.name + ' is disabled by the local user');
      if (rule === 'ask') return await super.authorize({...tool, risk: 'explicit'}, args, {...context, mode: 'ask', allow: undefined}, preview);
      return await super.authorize(tool, args, rule === 'allow' ? {...context, allow: new Set([risk])} : context, preview);
    } catch (error) {
      // A denied browser task may not evade the decision by using a different tool.
      if (['APPROVAL_DENIED', 'TOOL_DENIED', 'READ_ONLY'].includes(error.code)) this.onDenied?.(context.sessionId);
      throw error;
    }
  }
}
