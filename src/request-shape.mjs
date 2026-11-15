import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const hash = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');

// No headers, credentials, response bodies, reasoning items, or raw prompts.
export function requestShape(payload) {
  if (!payload || typeof payload !== 'object') return { unsupported: true };
  const input = Array.isArray(payload.input) ? payload.input : [];
  return {
    model: payload.model,
    instructions_hash: hash(payload.instructions),
    instructions_chars: typeof payload.instructions === 'string' ? payload.instructions.length : 0,
    native_skill_hint_qualified: typeof payload.instructions === 'string' && payload.instructions.includes('Already injected native skills:'),
    tools_hash: hash(payload.tools),
    tool_names: (payload.tools ?? []).map(tool => tool.name ?? tool.type),
    cache_key_hash: payload.prompt_cache_key ? hash(payload.prompt_cache_key) : null,
    parallel_tool_calls: payload.parallel_tool_calls,
    input_shape: input.map(item => ({ type: item.type, role: item.role,
      // Only user text is compared. Assistant/hidden reasoning is never recorded.
      ...(item.role === 'user' ? { content_hash: hash(item.content) } : {}),
    })),
  };
}

export default function requestShapeExtension(pi) {
  let calls = 0;
  pi.on('before_provider_request', (event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    if (!file) throw new Error('Request-shape telemetry requires a session file.');
    appendFileSync(`${file}.request-shape.jsonl`, JSON.stringify({ call: ++calls, ...requestShape(event.payload) }) + '\n');
  });
}
