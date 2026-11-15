import { normalize } from 'node:path';

const hint = "Use the read tool to load a skill's file when the task matches its description.";
const key = value => { const normalized = normalize(value); return process.platform === 'win32' ? normalized.toLowerCase() : normalized; };
const text = content => typeof content === 'string' ? content : (content ?? []).filter(part => ['text','input_text'].includes(part.type)).map(part => part.text).join('\n');

// Only complete native leading blocks matching this invocation's inventory count.
// No filesystem reads or persistent loaded flags. Compaction can remove evidence.
export function loadedNativeSkills(messages, inventory) {
  const loaded = new Set();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const match = text(message.content).match(/^<skill name="([^"]+)" location="([^"]+)">\r?\n([\s\S]*?)\r?\n<\/skill>(?:\r?\n\r?\n[\s\S]*)?$/);
    if (!match || !match[3].replace(/^References are relative to [^\n]+\.\r?\n\r?\n/, '').trim()) continue;
    if (inventory.some(skill => skill.name === match[1] && key(skill.filePath) === key(match[2]))) loaded.add(match[1]);
  }
  return [...loaded].sort();
}

export function qualifySkillLoading(messages, inventory) {
  const loaded = loadedNativeSkills(messages, inventory);
  if (!loaded.length) return messages;
  const qualified = `Already injected native skills: ${loaded.join(', ')}. Pi has loaded their complete native bodies from the selected files through its normal activation gate. Follow those bodies. Do not read or reload their SKILL.md to activate them or verify that loading happened. General instructions to read or load selected skills are already satisfied by these native bodies; they do not request a refresh. Use the read tool for a skill whose complete body is absent, for supporting files, or when the task explicitly requires inspecting or refreshing current on-disk instructions. Names, paths, summaries, and catalog entries alone do not establish loading. Keep every permission gate intact.`;
  return messages.map(message => {
    if (message.role !== 'system') return message;
    const replace = value => value.includes(qualified) ? value : value.replace(hint, qualified);
    return { ...message, content: typeof message.content === 'string' ? replace(message.content)
      : message.content.map(part => part.type === 'text' ? { ...part, text: replace(part.text) } : part),
      ...(message.sections ? { sections: Object.fromEntries(Object.entries(message.sections).map(([name, value]) => [name, value === null ? null : replace(value)])) } : {}),
    };
  });
}

export function qualifyProviderPayload(payload) {
  if (!payload || typeof payload.instructions !== 'string' || !Array.isArray(payload.input)) return payload;
  const decode = value => value.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const inventory = [...payload.instructions.matchAll(/<skill>\s*<name>([\s\S]*?)<\/name>[\s\S]*?<location>([\s\S]*?)<\/location>\s*<\/skill>/g)]
    .map(match => ({ name: decode(match[1]), filePath: decode(match[2]) }));
  const messages = [{ role: 'system', content: payload.instructions }, ...payload.input.filter(message => message.role === 'user')];
  const instructions = qualifySkillLoading(messages, inventory)[0].content;
  return instructions === payload.instructions ? payload : { ...payload, instructions };
}

export default function workerSkillLoading(pi) {
  // Pi's supported final-payload hook returns the payload itself, not {payload}.
  // Derive evidence from the actual wire-bound context, not mutable lifecycle state.
  pi.on('before_provider_request', event => qualifyProviderPayload(event.payload));
}
