import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fakePi = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url));
const config = { piCli: fakePi, writesEnabled: false, startupTimeoutMs: 2000, taskTimeoutMs: 5000 };
async function finished(bridge, id) {
  for (let i = 0; i < 100; i++) {
    const result = await bridge.status(id, { waitMs: 20 });
    if (!['running', 'starting', 'waiting_for_user'].includes(result.state)) return result;
  }
  throw new Error('Worker did not finish');
}

test('a background worker inherits the selected portable skill and normal Pi model defaults', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'echo-handoff', context: 'Preserve formulas.', skills: ['caveman'] });
  const result = await finished(bridge, worker.id);
  assert.equal(result.state, 'completed');
  assert.equal(result.model.id, 'normal-pi-default');
  assert.equal(result.thinkingLevel, 'high');
  assert.match(result.text, /Use concise language/);
  assert.match(result.text, /Preserve formulas/);
  assert.deepEqual(result.selectedSkills, ['caveman']);
  assert.equal(result.fallbackAllowed, false);
});

test('worker skill hook is invocation-scoped and does not replace the Pi system prompt', async t => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'report-skill-policy', skills: ['caveman'] });
  const result = JSON.parse((await finished(bridge, worker.id)).text);
  assert.ok(result.extensions.some(file => file.endsWith('worker-skill-loading.mjs')));
  assert.equal(result.replacesSystem, false);
  assert.match(result.prompt, /Use concise language/);
});

test('fresh invocations expand changed skill bytes rather than trusting a path-only loaded flag', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-skill-version-'));
  const skillDirectory = path.join(directory, 'versioned');
  await mkdir(skillDirectory);
  const skillPath = path.join(skillDirectory, 'SKILL.md');
  const bridge = new Bridge({ config, root });
  t.after(async () => { await bridge.close(); await rm(directory, { recursive: true, force: true }); });
  for (const version of ['original instruction', 'changed instruction']) {
    await writeFile(skillPath, `---\nname: versioned\ndescription: fixture\n---\n${version}\n`);
    const worker = await bridge.delegate({ cwd: root, task: 'echo-handoff', skills: ['versioned'], skillPaths: [skillPath] });
    const result = await finished(bridge, worker.id);
    assert.match(result.text, new RegExp(version));
    if (version.startsWith('changed')) assert.doesNotMatch(result.text, /original instruction/);
  }
});

test('read-only workers expose only safe declared tools without disabling extensions or bypassing project trust', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'report-tool-policy' });
  assert.deepEqual(JSON.parse((await finished(bridge, worker.id)).text), {
    tools: 'read,grep,find,ls', excludedTools: 'mcp__*', extensionsDisabled: false, trustForced: false, contextDisabled: false,
  });
});

test('a timed-out task requires reconciliation and cannot trigger native fallback', async (t) => {
  const bridge = new Bridge({ config: { ...config, taskTimeoutMs: 50 }, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'hold-open' });
  const result = await finished(bridge, worker.id);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /timed out/);
  assert.equal(result.needsReconciliation, true);
  assert.equal(result.fallbackAllowed, false);
});

test('cancelled work blocks overlapping reruns until partial work is reconciled', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'hold-open' });
  for (let i = 0; i < 100; i++) {
    if ((await bridge.status(worker.id, { waitMs: 20 })).state === 'running') break;
  }
  const result = await bridge.cancel(worker.id);
  assert.equal(result.state, 'cancelled');
  assert.equal(result.needsReconciliation, true);
  await assert.rejects(bridge.delegate({ cwd: root, task: 'rerun' }), { code: 'CHECKOUT_BUSY', fallbackAllowed: false });
});

test('an invalid access mode cannot accidentally obtain the normal write-capable tool set', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  await assert.rejects(bridge.delegate({ cwd: root, task: 'hello', access: 'anything-else' }), { code: 'INVALID_ACCESS', fallbackAllowed: false });
});

test('write-capable tasks stay blocked until the user verifies approval forwarding', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  await assert.rejects(bridge.delegate({ cwd: root, task: 'edit a file', access: 'write' }), { code: 'APPROVAL_NOT_VERIFIED', fallbackAllowed: false });
});

test('denied skill activation cannot be bypassed by injecting its body as ordinary task text', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'echo-handoff', skills: ['blocked'] });
  const result = await finished(bridge, worker.id);
  assert.equal(result.state, 'failed');
  assert.equal(result.fallbackAllowed, false);
  assert.doesNotMatch(result.text, /This skill body/);
});

test('a missing required skill fails without allowing native fallback', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'hello', skills: ['not-installed'] });
  const result = await finished(bridge, worker.id);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /Required skill/);
  assert.equal(result.fallbackAllowed, false);
  assert.equal(result.needsReconciliation, false);
});

test('missing Pi permits only explicitly announced before-start fallback', async (t) => {
  const bridge = new Bridge({ config: { ...config, piCli: root + '/missing-pi.mjs' }, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'hello' });
  const result = await finished(bridge, worker.id);
  assert.equal(result.fallbackAllowed, true);
  assert.match(result.fallbackInstruction, /Announce explicitly/);
  assert.equal(result.needsReconciliation, false);
});

test('an extension question waits for the external human-dialog adapter, not a model answer tool', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'require-approval' });
  let status;
  for (let i = 0; i < 100; i++) {
    status = await bridge.status(worker.id, { waitMs: 20 });
    if (status.pendingUiCount) break;
  }
  assert.equal(status.state, 'waiting_for_user');
  assert.equal(status.text, '');
  await bridge.status(worker.id, { handleUi: async (request) => {
    assert.equal(request.title, 'Permission Required');
    return { value: 'No' };
  } });
  assert.equal((await finished(bridge, worker.id)).text, 'Denied safely');
});

test('a mid-task process crash requires reconciliation and never permits automatic fallback', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'crash-mid-task' });
  const result = await finished(bridge, worker.id);
  assert.equal(result.state, 'failed');
  assert.equal(result.fallbackAllowed, false);
  assert.equal(result.needsReconciliation, true);
});

test('runtime extension errors fail closed instead of silently continuing without protection', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'extension-failure' });
  const result = await finished(bridge, worker.id);
  assert.match(result.error, /extension failed/);
  assert.equal(result.fallbackAllowed, false);
});

test('parallel readers are allowed but overlapping modifications are refused', async (t) => {
  const bridge = new Bridge({ config: { ...config, writesEnabled: true }, root });
  t.after(() => bridge.close());
  await bridge.delegate({ cwd: root, task: 'hold-open' });
  await bridge.delegate({ cwd: root, task: 'hold-open' });
  await assert.rejects(bridge.delegate({ cwd: root, task: 'edit', access: 'write' }), { code: 'CHECKOUT_BUSY' });
});

test('completed workers accept follow-ups without opening an unrelated Pi session', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'first task', model: 'explicit-model', thinking: 'low' });
  const first = await finished(bridge, worker.id);
  assert.equal(first.model.id, 'explicit-model');
  assert.equal(first.thinkingLevel, 'low');
  await bridge.followUp(worker.id, 'second task');
  const second = await finished(bridge, worker.id);
  assert.equal(second.id, first.id);
  assert.equal(second.text, 'Done: 雪\u2028line\u2029end');
});

test('explicit skill exclusions remove inherited instructions from the handoff', async (t) => {
  const bridge = new Bridge({ config, root });
  t.after(() => bridge.close());
  const worker = await bridge.delegate({ cwd: root, task: 'echo-handoff', skills: ['caveman'], excludeSkills: ['caveman'] });
  const result = await finished(bridge, worker.id);
  assert.deepEqual(result.selectedSkills, []);
  assert.doesNotMatch(result.text, /Use concise language/);
  assert.match(result.text, /Do not activate or follow these excluded skills: caveman/);
});
