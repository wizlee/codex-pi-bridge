import test from 'node:test';
import assert from 'node:assert/strict';
import workerSkillLoading, { loadedNativeSkills, qualifySkillLoading, qualifyProviderPayload } from '../src/worker-skill-loading.mjs';
const inventory = [{ name: 'style', filePath: '/skills/style/SKILL.md' }];
const body = '<skill name="style" location="/skills/style/SKILL.md">\nReferences are relative to /skills/style.\n\nActual instructions.\n</skill>\n\nTask';
const system = { role: 'system', content: "Rules. Use the read tool to load a skill's file when the task matches its description. Tail.", tools: [{ name: 'read' }] };
test('only complete matching native bodies qualify the built-in hint, idempotently', () => {
  const input = [system, { role: 'user', content: [{ type: 'text', text: body }] }];
  const result = qualifySkillLoading(input, inventory);
  assert.deepEqual(loadedNativeSkills(input, inventory), ['style']);
  assert.match(result[0].content, /Already injected native skills: style/);
  assert.deepEqual(result[0].tools, system.tools);
  assert.equal(result[1], input[1]);
  assert.deepEqual(qualifySkillLoading(result, inventory), result);
  assert.equal(system.content.includes('Already injected'), false);
});
test('names, paths, summaries, mismatched identities, quotes, and truncated bodies do not count', () => {
  for (const content of ['style /skills/style/SKILL.md', 'Already loaded style', body.slice(0, -20), 'Quoted source:\n' + body,
    body.replace('name="style"', 'name="other"'), body.replace('/skills/style/SKILL.md', '/other/SKILL.md')]) {
    const input = [system, { role: 'user', content }];
    assert.deepEqual(loadedNativeSkills(input, inventory), []);
    assert.equal(qualifySkillLoading(input, inventory), input);
  }
});
test('removed context cannot inherit an old loaded flag; changed bodies are evaluated afresh', () => {
  assert.deepEqual(loadedNativeSkills([{ role: 'user', content: body }], inventory), ['style']);
  assert.deepEqual(loadedNativeSkills([], inventory), []);
  assert.deepEqual(loadedNativeSkills([{ role: 'user', content: body.replace('Actual instructions.', 'Changed instructions.') }], inventory), ['style']);
  const parts = [{ role: 'system', content: [{ type: 'text', text: system.content }], tools: system.tools }, { role: 'user', content: body }];
  assert.match(qualifySkillLoading(parts, inventory)[0].content[0].text, /explicitly requires inspecting or refreshing/);
});
test('final provider hook derives current evidence and returns a raw payload', () => {
  const handlers = new Map();
  workerSkillLoading({ on: (name, handler) => handlers.set(name, handler) });
  const payload = { instructions: `${system.content}\n<available_skills>\n<skill>\n<name>style</name>\n<location>/skills/style/SKILL.md</location>\n</skill>\n</available_skills>`, input: [{ role: 'user', content: [{ type: 'input_text', text: body }] }], tools: [{ name: 'read' }], prompt_cache_key: 'isolated-session', parallel_tool_calls: true };
  const result = handlers.get('before_provider_request')({ payload });
  assert.match(result.instructions, /Already injected native skills: style/);
  assert.ok(!result.instructions.includes("Use the read tool to load a skill's file when the task matches its description."));
  assert.equal(result.payload, undefined);assert.equal(result.tools, payload.tools);assert.equal(result.input, payload.input);
  assert.equal(result.prompt_cache_key, payload.prompt_cache_key);assert.equal(result.parallel_tool_calls, true);
  assert.ok(!payload.instructions.includes('Already injected'));
  const withoutBody = { ...payload, input: [] };assert.equal(qualifyProviderPayload(withoutBody), withoutBody);
  const unsupported = { messages: [] };assert.equal(qualifyProviderPayload(unsupported), unsupported);
});
test('structured skills sections are qualified without changing tools, ordering, or null removals', () => {
  const frame = { role: 'system', content: 'Base prompt', sections: { rules: 'Unchanged', skills: system.content, removed: null }, toolsAdded: [{ name: 'read' }], toolsRemoved: [], timestamp: 1 };
  const result = qualifySkillLoading([frame, { role: 'user', content: body }], inventory)[0];
  assert.match(result.sections.skills, /Already injected native skills: style/);
  assert.deepEqual(Object.keys(result.sections), Object.keys(frame.sections));
  assert.equal(result.sections.rules, 'Unchanged');assert.equal(result.sections.removed, null);
  assert.equal(result.content, frame.content);assert.equal(result.toolsAdded, frame.toolsAdded);assert.equal(result.toolsRemoved, frame.toolsRemoved);
  assert.deepEqual(qualifySkillLoading([result, { role: 'user', content: body }], inventory)[0], result);
});
