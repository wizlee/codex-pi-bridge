import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestShape } from '../src/request-shape.mjs';
test('request shape compares prefixes without capturing secrets or reasoning', () => {
  const payload = { model: 'test', instructions: 'private instructions', tools: [{ name: 'read' }],
    prompt_cache_key: 'private session', input: [{ type: 'reasoning', summary: 'hidden' },
      { role: 'user', content: 'private prompt' }, { role: 'assistant', content: 'hidden output' }] };
  const shape = requestShape(payload);
  for (const secret of ['private instructions', 'private session', 'hidden', 'private prompt']) assert.ok(!JSON.stringify(shape).includes(secret));
  assert.deepEqual(shape, requestShape(structuredClone(payload)));
  assert.notEqual(shape.instructions_hash, requestShape({ ...payload, instructions: 'changed' }).instructions_hash);
});
