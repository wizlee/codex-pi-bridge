import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Bridge } from '../src/bridge.mjs';

function setup(t) {
  const bridge = new Bridge({ config: {}, root: '.' });
  t.after(() => { clearInterval(bridge.reaper); });
  const worker = { id: 'one', cwd: '.', state: 'running', text: '', notices: [], pendingUi: [], changes: new EventEmitter() };
  bridge.workers.set(worker.id, worker);
  return { bridge, worker };
}
test('stream activity does not consume a status wait', async t => {
  const { bridge, worker } = setup(t);
  const start = performance.now();
  const pending = bridge.status(worker.id, { waitMs: 100 });
  bridge.onRecord(worker, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } });
  assert.equal((await pending).state, 'running');
  assert.ok(performance.now() - start >= 80);
});
test('completion and pending human input wake immediately', async t => {
  for (const event of [{ type: 'agent_settled' }, { type: 'extension_ui_request', method: 'confirm', id: 'synthetic' }]) {
    const { bridge, worker } = setup(t);
    const pending = bridge.status(worker.id, { waitMs: 1000 });
    bridge.onRecord(worker, event);
    const result = await pending;
    assert.notEqual(result.state, 'running');
  }
});
test('multi-worker wait ignores intermediate text and returns first settled result', async t => {
  const { bridge, worker } = setup(t);
  const other = { ...worker, id: 'two', changes: new EventEmitter() };
  bridge.workers.set(other.id, other);
  let resolved = false;
  const pending = bridge.wait([worker.id, other.id], { waitMs: 1000 }).then(value => { resolved = true; return value; });
  bridge.onRecord(worker, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Working' }] } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(resolved, false);
  bridge.onRecord(other, { type: 'agent_settled' });
  const result = await pending;
  assert.equal(result.reason, 'settled');
  assert.equal(result.workers[0].text, undefined);
  assert.equal(result.workers[1].state, 'completed');
  assert.equal(worker.changes.listenerCount('change'), 0);
});
test('wait timeout and cancellation release all listeners without cancelling workers', async t => {
  const { bridge, worker } = setup(t);
  assert.equal((await bridge.wait([worker.id], { waitMs: 10 })).reason, 'timeout');
  const controller = new AbortController();
  const pending = bridge.wait([worker.id], { signal: controller.signal });
  controller.abort();
  assert.equal((await pending).reason, 'interrupted');
  assert.equal(worker.state, 'running');
  assert.equal(worker.changes.listenerCount('change'), 0);
});
test('failure wakes wait and retains reconciliation and fallback fields', async t => {
  const { bridge, worker } = setup(t);
  worker.submitted = true;
  const pending = bridge.wait([worker.id]);
  bridge.fail(worker, new Error('provider broke'));
  const result = await pending;
  assert.equal(result.workers[0].state, 'failed');
  assert.equal(result.workers[0].needsReconciliation, true);
  assert.equal(result.workers[0].fallbackAllowed, false);
});
test('a successful Pi-managed retry clears only the earlier assistant error', async t => {
  const { bridge, worker } = setup(t);
  bridge.onRecord(worker, { type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'WebSocket error' } });
  bridge.onRecord(worker, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Recovered final review' }] } });
  bridge.onRecord(worker, { type: 'agent_settled', aborted: false });
  assert.equal(worker.state, 'completed');
  assert.equal(worker.error, undefined);
  assert.equal(worker.needsReconciliation, false);
});
test('fatal bridge failures cannot be cleared by late assistant messages', async t => {
  const { bridge, worker } = setup(t);
  worker.submitted = true;
  bridge.fail(worker, new Error('Extension failed'));
  bridge.onRecord(worker, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Late output' }] } });
  bridge.onRecord(worker, { type: 'agent_settled', aborted: false });
  assert.equal(worker.state, 'failed');
  assert.equal(worker.error, 'Extension failed');
  assert.equal(worker.needsReconciliation, true);
});
