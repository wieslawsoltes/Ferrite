import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentWorkbench} from '../src/ui/agent/AgentWorkbench.js';

function workbench(events, selected = 'task-a') {
  const loaded = [], rendered = [];
  let refreshes = 0;
  const subject = Object.create(AgentWorkbench.prototype);
  Object.assign(subject, {
    environment: 'browser', browserClient: {}, client: {}, generation: 1,
    selected, cursor: 0, lastHeartbeat: Date.now(),
    view: {handle: event => rendered.push(event.type), showError: error => { throw error; }},
    browserPanels: {handle() {}},
    request: async () => ({cursor: 1, events, gap: false}),
    refreshSessions: async () => { refreshes++; },
    loadSession: async id => { loaded.push(id); }
  });
  return {subject, loaded, rendered, refreshes: () => refreshes};
}

test('completed compaction reloads the selected summary after an intervening poll', async () => {
  // A session.completed refresh can load "compacting" while an explicit compact
  // call is pending. Its old selection-generation guard then declines to repaint.
  // Completion must independently refresh the latest authoritative snapshot.
  const state = workbench([{type: 'context.compaction-finished', sessionId: 'task-a'}]);
  await state.subject.poll();
  assert.deepEqual(state.loaded, ['task-a']);
  assert.deepEqual(state.rendered, ['context.compaction-finished']);
  assert.equal(state.refreshes(), 1);
  assert.equal(state.subject.polling, false);
});

test('compaction of another task does not replace the selected task view', async () => {
  const state = workbench([{type: 'context.compaction-finished', sessionId: 'task-b'}]);
  await state.subject.poll();
  assert.deepEqual(state.loaded, []);
  assert.equal(state.subject.selected, 'task-a');
  assert.equal(state.refreshes(), 1);
});

test('compaction and session completion in one batch perform one snapshot refresh', async () => {
  const state = workbench([
    {type: 'session.completed', sessionId: 'task-a'},
    {type: 'context.compaction-finished', sessionId: 'task-a', cancelled: true}
  ]);
  await state.subject.poll();
  assert.deepEqual(state.loaded, ['task-a']);
  assert.equal(state.refreshes(), 1);
});
