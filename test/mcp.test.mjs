import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../src/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = { piCli: fileURLToPath(new URL('./fake-pi.mjs', import.meta.url)), writesEnabled: false, startupTimeoutMs: 2000, taskTimeoutMs: 5000 };
async function connect(t, respond, capabilities = { elicitation: { form: {} } }) {
  const { server, bridge } = createServer({ config, root });
  const client = new Client({ name: 'test-desktop', version: '1' }, { capabilities });
  if (respond) client.setRequestHandler(ElicitRequestSchema, respond);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await bridge.close(); await client.close(); await server.close(); });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { ...JSON.parse(result.content[0].text), isError: result.isError === true };
  };
  return { call, client };
}

test('MCP exposes delegation but no model-callable approval-answer or raw RPC tool', async (t) => {
  const { client, call } = await connect(t);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.deepEqual(names.sort(), ['pi_approval_probe', 'pi_cancel', 'pi_delegate', 'pi_discover', 'pi_follow_up', 'pi_status', 'pi_wait'].sort());
  const result = await call('pi_delegate', { cwd: root, task: 'edit', access: 'write' });
  assert.equal(result.code, 'APPROVAL_NOT_VERIFIED');
  assert.equal(result.fallbackAllowed, false);
  assert.equal(result.isError, true);
});

test('native-form probe requires explicit denial and approval and cannot unlock modifying tasks', async (t) => {
  const prompts = [];
  const { call } = await connect(t, async ({ params }) => {
    prompts.push(params);
    return { action: 'accept', content: { choice: params.message.includes('Choose Deny') ? 'Deny' : 'Approve once' } };
  });
  const result = await call('pi_approval_probe');
  assert.equal(result.nativeFormRoundTrip, true);
  assert.equal(result.writesEnabled, false);
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[0].requestedSchema.required, ['choice']);
  assert.equal(prompts[0].requestedSchema.properties.choice.default, undefined);
  assert.equal(config.writesEnabled, false);
});

test('native form-level decline is a safe denial path, not a reason to bypass the probe', async (t) => {
  const { call } = await connect(t, async ({ params }) => params.message.includes('Choose Deny')
    ? { action: 'decline' }
    : { action: 'accept', content: { choice: 'Approve once' } });
  const result = await call('pi_approval_probe');
  assert.equal(result.nativeFormRoundTrip, true);
  assert.equal(result.writesEnabled, false);
});

test('an empty automatic accept is never interpreted as human approval', async (t) => {
  const { call } = await connect(t, async () => ({ action: 'accept', content: {} }));
  const result = await call('pi_approval_probe');
  assert.equal(result.isError, true);
  assert.equal(result.fallbackAllowed, false);
});

test('MCP background status routes a real worker dialog through elicitation, not through model arguments', async (t) => {
  const { call } = await connect(t, async ({ params }) => {
    assert.match(params.message, /Permission Required/);
    return { action: 'accept', content: { choice: 'No' } };
  });
  const worker = await call('pi_delegate', { cwd: root, task: 'require-approval' });
  let status;
  for (let i = 0; i < 100; i++) {
    status = await call('pi_status', { id: worker.id, waitMs: 20 });
    if (status.state === 'completed') break;
  }
  assert.equal(status.text, 'Denied safely');
});

test('clients without elicitation support cannot grant worker approvals', async (t) => {
  const { call } = await connect(t, undefined, {});
  const worker = await call('pi_delegate', { cwd: root, task: 'require-approval' });
  let status;
  for (let i = 0; i < 100; i++) {
    status = await call('pi_status', { id: worker.id, waitMs: 20 });
    if (status.state === 'failed') break;
  }
  assert.equal(status.state, 'failed');
  assert.equal(status.fallbackAllowed, false);
  assert.equal(status.needsReconciliation, true);
});

for (const response of [{ action: 'accept', content: { choice: 'No' } }, { action: 'accept', content: {} }]) {
  test(`multi-worker wait forwards synthetic human dialog, fails closed for ${JSON.stringify(response.content)}`, async t => {
    let dialogs = 0;
    const { call } = await connect(t, async () => { dialogs++; return response; });
    const worker = await call('pi_delegate', { cwd: root, task: 'require-approval' });
    let result;
    for (let i = 0; i < 10; i++) {
      result = await call('pi_wait', { ids: [worker.id], waitMs: 1000 });
      if (['completed', 'failed'].includes(result.workers[0].state)) break;
    }
    assert.equal(dialogs, 1);
    assert.equal(result.workers[0].state, response.content.choice ? 'completed' : 'failed');
    assert.equal(result.workers[0].fallbackAllowed, false);
  });
}
