// A model-free external Pi process for testing the public JSONL boundary.
import { readFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
let text = '';
let pending;
let promptText = '';
const commands = [
  { name: 'permission-system', source: 'extension' },
  { name: 'skill:blocked', source: 'skill', sourceInfo: { path: fileURLToPath(new URL('./skills/blocked/SKILL.md', import.meta.url)) } },
  { name: 'skill:caveman', source: 'skill', sourceInfo: { path: fileURLToPath(new URL('./skills/caveman/SKILL.md', import.meta.url)) } },
];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--skill') {
    const path = args[++i];
    const name = readFileSync(path, 'utf8').match(/^name:\s*(.+)$/m)?.[1];
    commands.push({ name: `skill:${name}`, source: 'skill', sourceInfo: { path } });
  }
}
function complete() {
  if (promptText.includes('provider-failure')) {
    emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Provider failed' } });
  } else {
    text = promptText.includes('report-skill-policy') ? JSON.stringify({ extensions: args.flatMap((arg, index) => arg === '--extension' ? [args[index + 1]] : []), replacesSystem: args.includes('--system-prompt'), prompt: promptText })
      : promptText.includes('report-tool-policy')
      ? JSON.stringify({ tools: value('--tools'), excludedTools: value('--exclude-tools'), extensionsDisabled: args.includes('--no-extensions'), trustForced: args.includes('--approve'), contextDisabled: args.includes('--no-context-files') })
      : promptText.includes('echo-handoff') ? promptText : 'Done: 雪\u2028line\u2029end';
    // The multibyte character is deliberately split across stdout chunks.
    const data = Buffer.from(JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } }) + '\n');
    const split = data.indexOf(Buffer.from('雪')) + 1;
    process.stdout.write(data.subarray(0, split));
    process.stdout.write(data.subarray(split));
  }
  emit({ type: 'agent_end' });
  setTimeout(() => emit({ type: 'agent_settled', aborted: false }), 15);
}
function handle(req) {
  const reply = (data) => emit({ type: 'response', id: req.id, command: req.type, success: true, data });
  switch (req.type) {
    case 'get_state':
      reply({ model: { provider: 'test', id: value('--model') ?? 'normal-pi-default' }, thinkingLevel: value('--thinking') ?? 'high', sessionId: value('--session-id'), sessionFile: 'fake-session.jsonl' });
      break;
    case 'get_commands': reply({ commands }); break;
    case 'prompt':
      if (req.message.startsWith('/skill:blocked ')) {
        emit({ type: 'extension_ui_request', id: 'denial', method: 'notify', notifyType: 'warning', message: "Skill 'blocked' is not permitted by the current skill policy." });
        reply({ disposition: 'handled' });
        break;
      }
      promptText = req.message;
      if (promptText.startsWith('/skill:')) {
        const space = promptText.indexOf(' ');
        const name = promptText.slice(7, space);
        const skill = commands.find((c) => c.name === `skill:${name}`);
        promptText = readFileSync(skill.sourceInfo.path, 'utf8') + '\n' + promptText.slice(space + 1);
      }
      reply({ disposition: 'started' });
      emit({ type: 'agent_start' });
      if (promptText.includes('crash-mid-task')) process.exit(2);
      else if (promptText.includes('extension-failure')) emit({ type: 'extension_error', extensionPath: 'permissions', error: 'Extension handler failed' });
      else if (promptText.includes('require-approval')) {
        pending = 'permission-1';
        emit({ type: 'extension_ui_request', id: pending, method: 'select', title: 'Permission Required', options: ['Yes', 'No'] });
      } else if (!promptText.includes('hold-open')) complete();
      break;
    case 'extension_ui_response':
      if (req.id !== pending) break;
      pending = undefined;
      text = req.value === 'Yes' ? 'Approved by user' : 'Denied safely';
      emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } });
      emit({ type: 'agent_settled', aborted: false });
      break;
    case 'clear_queue': reply({}); break;
    case 'abort': reply({}); emit({ type: 'agent_settled', aborted: true }); break;
    default: emit({ type: 'response', id: req.id, command: req.type, success: false, error: 'Unknown command' });
  }
}
const decoder = new StringDecoder('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += decoder.write(chunk);
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
