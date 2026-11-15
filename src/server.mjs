import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Bridge, BridgeError } from './bridge.mjs';
import packageInfo from '../package.json' with { type: 'json' };

const instructions = `Use Pi for delegated agents while Codex may work directly. Call pi_discover to check this project's Pi resources, then pi_status for its inventory. In pi_delegate explicitly name applicable portable active skills, relevant context, and user-requested overrides; active Codex skills are not automatically visible here. For active task workers use pi_wait with up to 60000 ms and all remaining worker IDs; it forwards human dialogs internally and returns compact completion or attention results. Omit settled IDs on later waits. Use pi_status for discovery and detailed diagnostics. Avoid sleep/status loops. Never answer permission dialogs yourself. There is no answer or raw-RPC tool. Coordinate direct Codex writes with workers: parallel readers are allowed, but modifying work must not overlap. Native fallback requires fallbackAllowed=true before task execution and an explicit announcement to the user. Never fall back after task submission, denial, missing skills, or an approval/compatibility gate. Worker IDs are local to this server process. After failure/restart, inspect partial work and ask the user before rerunning. Skill exclusions are handoff instructions, not a sandbox. Read-only workers expose only read/grep/find/ls; extensions still run with their normal OS permissions. Modifying workers remain locked until the user verifies desktop approval forwarding.`;

export function createServer({ config, root }) {
  const bridge = new Bridge({ config, root });
  const server = new McpServer({ name: packageInfo.name, version: packageInfo.version }, { instructions });
  const result = (data, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError });
  const guard = (handler) => async (args, extra) => {
    try {
      const data = await handler(args, extra);
      return result(data, data?.state === 'failed');
    } catch (error) {
      return result({ code: error.code ?? 'BRIDGE_ERROR', error: error.message, fallbackAllowed: error.fallbackAllowed === true }, true);
    }
  };

  async function dialog(request, extra) {
    const choices = request.method === 'select' ? request.options : ['Allow once', 'Deny'];
    const isChoice = ['select', 'confirm'].includes(request.method);
    if (isChoice && (!Array.isArray(choices) || !choices.length)) throw new BridgeError('INVALID_DIALOG', 'Pi supplied no valid choices.');
    const field = isChoice ? 'choice' : 'text';
    const response = await server.server.elicitInput({
      mode: 'form',
      message: `${request.title ?? 'Pi requests user input'}${request.message ? `\n${request.message}` : ''}${request.placeholder ? `\n${request.placeholder}` : ''}\nAnswer in the native dialog. Codex must not supply this answer.`,
      requestedSchema: {
        type: 'object',
        properties: { [field]: isChoice ? { type: 'string', title: 'Your decision', enum: choices } : { type: 'string', title: 'Your response' } },
        required: [field],
      },
    }, { relatedRequestId: extra.requestId, signal: extra.signal, timeout: Math.min(request.timeout ?? 300000, 300000) });
    if (response.action !== 'accept') return { cancelled: true };
    const value = response.content?.[field];
    if (typeof value !== 'string' || (isChoice && !choices.includes(value))) {
      throw new BridgeError('INVALID_APPROVAL', 'The client did not return an explicit valid user choice. An empty automatic accept is not approval.');
    }
    return request.method === 'confirm' ? { confirmed: value === 'Allow once' } : { value };
  }

  server.registerTool('pi_discover', {
    description: 'Inspect normal Pi model, thinking, skills and extension commands for an absolute project directory without calling a model. Returns a background ID; poll pi_status.',
    inputSchema: { cwd: z.string().min(1).describe('Absolute project directory, not the bridge installation directory.') },
    annotations: { readOnlyHint: true },
  }, guard(({ cwd }) => bridge.discover(cwd)));

  server.registerTool('pi_delegate', {
    description: 'Start a background Pi worker. Default read-only. Hand off context and portable skills explicitly. Pi natively expands the first selected skill after its activation gate; its complete body is already supplied to the worker. Do not add handoff instructions to reread that first skill merely to activate it. Additional skills use gated reads. Overrides only when user-requested. Use pi_wait for completion and human dialogs.',
    inputSchema: {
      cwd: z.string().min(1),
      task: z.string().min(1).max(50000),
      context: z.string().max(50000).optional(),
      access: z.enum(['read', 'write']).default('read'),
      skills: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).max(30).default([]).describe('First selected skill uses native gated activation and arrives as a complete body; additional skills use gated reads. Supply names/paths, not duplicate file-loading instructions.'),
      excludeSkills: z.array(z.string()).max(30).default([]),
      skillPaths: z.array(z.string()).max(30).default([]).describe('Optional absolute SKILL.md paths for portable skills outside Pi discovery. Also name each requested skill in skills.'),
      model: z.string().optional().describe('Only an explicit user-requested Pi model override.'),
      thinking: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, guard((options) => bridge.delegate(options)));

  server.registerTool('pi_status', {
    description: 'Poll worker status/results. Required while a worker runs: pending Pi dialogs are forwarded through native MCP elicitation, never model-authored answers. Prefer waitMs=10000 to avoid busy polling.',
    inputSchema: { id: z.string(), waitMs: z.number().int().min(0).max(15000).default(10000) },
    annotations: { readOnlyHint: false },
  }, guard(({ id, waitMs }, extra) => bridge.status(id, { waitMs, handleUi: (request) => dialog(request, extra) })));

  server.registerTool('pi_wait', {
    description: 'Wait for any selected worker to finish or need human input. For active task workers prefer this over sleep/status loops. Returns compact states and settled results; omit already settled IDs on later waits. Human dialogs use the same native approval adapter as pi_status.',
    inputSchema: { ids: z.array(z.string()).min(1).max(4), waitMs: z.number().int().min(0).max(60000).default(60000) },
    annotations: { readOnlyHint: false },
  }, guard(({ ids, waitMs }, extra) => bridge.wait(ids, {
    waitMs, signal: extra.signal, handleUi: (request) => dialog(request, extra),
  })));

  server.registerTool('pi_follow_up', {
    description: 'Give a successfully completed task worker another task in the same session, keeping its existing access, model, context and skill policy. No follow-up after failed/cancelled work.',
    inputSchema: { id: z.string(), task: z.string().min(1).max(50000) },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, guard(({ id, task }) => bridge.followUp(id, task)));

  server.registerTool('pi_cancel', {
    description: 'Cancel one worker and close its Pi process. Partial work must be reconciled with the user; do not automatically rerun or fall back.',
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: false },
  }, guard(({ id }) => bridge.cancel(id)));

  server.registerTool('pi_approval_probe', {
    description: 'User-requested desktop setup test: show two native dialogs (deny, then approve). Runs no Pi task or shell command and never unlocks modifying workers. The user must visually verify these dialogs before enabling writes.',
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, guard(async (_, extra) => {
    const deny = await dialog({ method: 'select', title: 'Pi bridge setup check: Choose Deny. No command will run.', options: ['Approve once', 'Deny'] }, extra);
    if (deny.value !== 'Deny' && deny.cancelled !== true) throw new BridgeError('PROBE_INCOMPLETE', 'Choose Deny or decline the first native dialog to test the denial path.');
    const approve = await dialog({ method: 'select', title: 'Pi bridge setup check: Choose Approve once. No command will run.', options: ['Approve once', 'Deny'] }, extra);
    if (approve.value !== 'Approve once') throw new BridgeError('PROBE_INCOMPLETE', 'Choose Approve once in the second native dialog to test the explicit approval path.');
    return {
      nativeFormRoundTrip: true, writesEnabled: config.writesEnabled,
      next: 'The user must confirm that both dialogs were personally answered in the desktop UI. This probe alone does not prove human provenance or end-to-end Pi permission enforcement and does not change configuration. Keep writes disabled pending that verification and a real permission-extension check.',
    };
  }));
  return { server, bridge };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = JSON.parse(await readFile(process.env.PI_BRIDGE_CONFIG ?? path.join(root, 'config.json'), 'utf8'));
  if (typeof config.piCli !== 'string' || !path.isAbsolute(config.piCli) || typeof config.writesEnabled !== 'boolean'
      || typeof config.requestShapeTelemetry !== 'boolean'
      || (config.sessionDir !== undefined && (typeof config.sessionDir !== 'string' || !path.isAbsolute(config.sessionDir)))
      || !Number.isSafeInteger(config.startupTimeoutMs) || config.startupTimeoutMs < 1000
      || !Number.isSafeInteger(config.taskTimeoutMs) || config.taskTimeoutMs < 1000) {
    throw new Error('Invalid pi-bridge/config.json; refusing to start with ambiguous permissions or timeouts.');
  }
  const { server, bridge } = createServer({ config, root });
  let stopping;
  const shutdown = () => stopping ??= (async () => { await bridge.close(); await server.close(); })();
  server.server.onclose = () => { void shutdown(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(); });
  await server.connect(new StdioServerTransport());
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Pi bridge: ${error.message}`); process.exitCode = 1; });
}
