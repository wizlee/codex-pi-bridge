import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiRpc } from '../src/rpc.mjs';

const fakePi = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url));

test('Pi RPC preserves Unicode and waits for the settled event, not agent_end', async (t) => {
  const rpc = new PiRpc({ cli: fakePi, cwd: process.cwd(), args: ['--session-id', 'test-session'], timeoutMs: 1000 });
  t.after(() => rpc.close());
  const state = await rpc.request('get_state');
  assert.equal(state.sessionId, 'test-session');
  const ended = once(rpc, 'agent_end');
  const settled = once(rpc, 'agent_settled');
  const message = once(rpc, 'message_end');
  await rpc.request('prompt', { message: 'hello' });
  await ended;
  assert.equal((await message)[0].message.content[0].text, 'Done: 雪\u2028line\u2029end');
  assert.equal((await settled)[0].aborted, false);
});
