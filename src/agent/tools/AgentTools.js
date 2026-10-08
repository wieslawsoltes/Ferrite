import {object, text, integer} from './ToolSchemas.js';
import {AgentError} from '../core/AgentError.js';

export function registerAgentTools(registry, runtime) {
  registry.register({name: 'plan_update', category: 'agent', risk: 'plan', description: 'Replace this session’s visible execution plan with precise steps and statuses. Keep at most one step in progress. This records plans, not evidence that work has been completed.',
    inputSchema: object({steps: {type: 'array', maxItems: 30, items: object({step: {...text(1000), minLength: 1}, status: {enum: ['pending', 'in_progress', 'completed']}})}}), run: async ({steps}, context) => {
      if (steps.filter(step => step.status === 'in_progress').length > 1) throw Error('At most one plan step may be in progress');
      if (!context.setPlan) throw new AgentError('AGENT_SESSION_REQUIRED', 'Plan updates require a built-in agent session');
      await context.setPlan(steps); return {steps};
    }});
  registry.register({name: 'agent_delegate', category: 'agent', risk: 'execute', description: 'Delegate a bounded, read-only research/review task to one child agent using this session’s provider and model. Child tools cannot edit or execute native programs. One delegation level only. The child’s provider usage is charged to the parent budget. Returns the completed answer and visible child session ID.',
    inputSchema: object({task: {...text(16000), minLength: 1}, maxSteps: integer(1, 15)}, ['task']), run: async ({task, maxSteps = 8}, context) => {
      if (!context.session || (context.depth ?? 0) >= 1) throw new AgentError('DELEGATION_DEPTH', 'Only a top-level built-in session can delegate');
      const parent = context.session, budget = Math.min(60000, parent.config.maxTotalTokens - parent.usage.input - parent.usage.output);
      if (budget < 1000) throw new AgentError('TOKEN_BUDGET', 'Insufficient remaining token budget to delegate');
      const child = await runtime.harness.create({...parent.config, mode: 'read-only', maxSteps, maxTotalTokens: budget}, {parentId: parent.id});
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(600000)].filter(Boolean));
      runtime.events.emit('agent.delegated', {sessionId: parent.id, childId: child.id, task});
      await runtime.harness.start(child.id, task, {interactive: false, depth: 1, signal});
      try { await runtime.harness.wait(child.id); }
      finally { runtime.harness.usage(parent, child.usage); await runtime.harness.save(parent); }
      return {childId: child.id, status: child.status, text: child.messages.findLast(message => message.role === 'assistant')?.text ?? '', error: child.error, usage: child.usage};
    }});
}
