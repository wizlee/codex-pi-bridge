import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { access, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { PiRpc } from './rpc.mjs';

export class BridgeError extends Error {
  constructor(code, message, fallbackAllowed = false) {
    super(message); this.code = code; this.fallbackAllowed = fallbackAllowed;
  }
}
const active = (worker) => ['starting', 'running', 'waiting_for_user'].includes(worker.state);
const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const overlap = (a, b) => {
  a = key(a); b = key(b);
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
};
const clip = (text, limit = 24000) => text.length <= limit ? text : `${text.slice(0, limit / 2)}\n[truncated; inspect the Pi session file]\n${text.slice(-limit / 2)}`;

export class Bridge {
  constructor({ config, root }) {
    this.config = config;
    this.root = root;
    this.workers = new Map();
    this.closed = false;
    this.reaper = setInterval(() => {
      for (const worker of this.workers.values()) {
        if (!active(worker) && !worker.needsReconciliation && Date.now() - worker.changedAt > 30 * 60 * 1000) {
          void worker.rpc?.close(); this.workers.delete(worker.id);
        }
      }
    }, 60000);
    this.reaper.unref();
  }

  change(worker) { worker.changedAt = Date.now(); worker.changes.emit('change'); }

  snapshot(worker) {
    return {
      id: worker.id, cwd: worker.cwd, access: worker.access, state: worker.state,
      model: worker.model, thinkingLevel: worker.thinkingLevel,
      selectedSkills: worker.selectedSkills, excludedSkills: worker.excludedSkills,
      ...(worker.discovery ? {
        skills: worker.availableSkills, extensionCommands: worker.extensionCommands,
        resourceLoading: 'Normal Pi RPC discovery. Saved project trust applies; untrusted project resources can be skipped. Save trust in interactive Pi first when full project-resource parity is required. TUI-only capabilities remain unavailable.',
      } : {}),
      sessionFile: worker.sessionFile, text: clip(worker.text),
      pendingUiCount: worker.pendingUi.length, notifications: worker.notices,
      error: worker.error, fallbackAllowed: worker.fallbackAllowed,
      needsReconciliation: worker.needsReconciliation,
      ...(worker.fallbackAllowed ? { fallbackInstruction: 'Announce explicitly to the user that native Codex fallback is being used before starting it.' } : {}),
    };
  }

  async delegate(options) { return this.create({ access: 'read', ...options, discovery: false }); }
  async discover(cwd) { return this.create({ cwd, access: 'read', discovery: true }); }

  async create(options) {
    if (this.closed) throw new BridgeError('CLOSED', 'The bridge is shutting down.');
    if (!['read', 'write'].includes(options.access)) throw new BridgeError('INVALID_ACCESS', 'access must be read or write.');
    if (!path.isAbsolute(options.cwd)) throw new BridgeError('INVALID_PROJECT', 'cwd must be an absolute project path.');
    const cwd = await realpath(options.cwd);
    if (!(await stat(cwd)).isDirectory()) throw new BridgeError('INVALID_PROJECT', 'cwd must be a directory.');
    if (options.access === 'write' && !this.config.writesEnabled) {
      throw new BridgeError('APPROVAL_NOT_VERIFIED', 'Write-capable workers are locked pending user verification of native desktop approval forwarding. Do not fall back to bypass this gate.');
    }
    if ([...this.workers.values()].filter(active).length >= 4) throw new BridgeError('BUSY', 'Four workers are already active; wait for one to finish.');
    for (const existing of this.workers.values()) {
      if (!overlap(cwd, existing.cwd)) continue;
      if (existing.needsReconciliation || (active(existing) && (options.access === 'write' || existing.access === 'write'))) {
        throw new BridgeError('CHECKOUT_BUSY', 'An overlapping checkout has active modifying work or unreconciled partial work. Coordinate with the user before continuing.');
      }
    }
    const worker = {
      id: randomUUID(), cwd, access: options.access, discovery: options.discovery,
      state: 'starting', changedAt: Date.now(), changes: new EventEmitter(),
      selectedSkills: [], excludedSkills: options.excludeSkills ?? [], availableSkills: [], extensionCommands: [],
      text: '', notices: [], pendingUi: [], submitted: false,
      fallbackAllowed: false, needsReconciliation: false,
    };
    this.workers.set(worker.id, worker);
    void this.start(worker, options).catch((error) => this.fail(worker, error));
    return this.snapshot(worker);
  }

  async start(worker, options) {
    try { await access(this.config.piCli); }
    catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new BridgeError('PI_UNAVAILABLE', `Pi CLI is unavailable at ${this.config.piCli}.`, true);
      throw new BridgeError('PI_ACCESS_DENIED', `Cannot access Pi CLI: ${error.message}. Do not bypass filesystem permissions with fallback.`);
    }
    const sessionDir = this.config.sessionDir ?? path.join(this.root, 'sessions');
    await mkdir(sessionDir, { recursive: true });
    const args = ['--session-id', worker.id, '--session-dir', sessionDir, '--name', `Codex worker ${worker.id.slice(0, 8)}`];
    if (!worker.discovery) args.push('--extension', path.join(this.root, 'src', 'worker-skill-loading.mjs'));
    if (!worker.discovery && this.config.requestShapeTelemetry) args.push('--extension', path.join(this.root, 'src', 'request-shape.mjs'));
    if (worker.access === 'read') args.push('--tools', 'read,grep,find,ls', '--exclude-tools', 'mcp__*');
    if (options.model) args.push('--model', options.model);
    if (options.thinking) args.push('--thinking', options.thinking);
    for (const skillPath of options.skillPaths ?? []) {
      if (!path.isAbsolute(skillPath)) throw new BridgeError('INVALID_SKILL', 'Additional skill paths must be absolute.');
      const info = await stat(skillPath);
      if (!info.isFile() || path.basename(skillPath) !== 'SKILL.md') throw new BridgeError('INVALID_SKILL', 'Additional skill paths must point to SKILL.md files.');
      args.push('--skill', skillPath);
    }
    if (worker.state !== 'starting') return;
    const env = this.config.agentDir ? { ...process.env, PI_CODING_AGENT_DIR: this.config.agentDir } : process.env;
    const rpc = worker.rpc = new PiRpc({ cli: this.config.piCli, cwd: worker.cwd, args, timeoutMs: this.config.startupTimeoutMs, env });
    rpc.on('record', (event) => this.onRecord(worker, event));
    rpc.on('failure', (error) => this.fail(worker, error));
    const state = await rpc.request('get_state');
    const inventory = await rpc.request('get_commands');
    if (worker.state !== 'starting') return;
    if (/failed to load|errors? loading|failed.*extension|extension.*(?:failed|error)/i.test(rpc.stderr)) {
      throw new BridgeError('EXTENSION_FAILURE', `Pi reported a resource-loading failure: ${rpc.stderr}`);
    }
    const commands = inventory.commands ?? [];
    worker.extensionCommands = commands.filter((c) => c.source === 'extension').map((c) => c.name);
    if (!worker.extensionCommands.includes('permission-system')) {
      throw new BridgeError('PERMISSIONS_MISSING', 'The installed Pi permission extension did not register its command. Refusing to run without the expected protection.');
    }
    worker.availableSkills = commands.filter((c) => c.source === 'skill').map((c) => ({ name: c.name.replace(/^skill:/, ''), path: c.sourceInfo?.path, description: c.description }));
    worker.model = state.model ? { provider: state.model.provider, id: state.model.id } : null;
    worker.thinkingLevel = state.thinkingLevel;
    worker.sessionFile = state.sessionFile;
    if (worker.discovery) {
      worker.state = 'completed'; this.change(worker); await rpc.close(); return;
    }
    const selected = [...new Set(options.skills ?? [])].filter((name) => !worker.excludedSkills.includes(name));
    const skillReads = [];
    for (const [index, name] of selected.entries()) {
      const skill = worker.availableSkills.find((entry) => entry.name === name);
      if (!skill?.path) throw new BridgeError('SKILL_MISSING', `Required skill '${name}' is unavailable in this Pi invocation. Do not substitute a native agent to bypass this requirement.`);
      if (index > 0) skillReads.push(`Use Pi's read tool to load and follow skill ${JSON.stringify(name)} at ${JSON.stringify(skill.path)} with explicit offset 1 and limit 200. Continue with explicit bounds until the entire body is available; never treat a truncated or compressed snippet as the full skill. Resolve supporting paths relative to ${JSON.stringify(path.dirname(skill.path))}.`);
    }
    worker.selectedSkills = selected;
    const handoff = [
      'Delegated task from Codex. Follow Pi rules and permission controls; never weaken them.',
      `Access: ${worker.access === 'read' ? 'read-only tools; do not modify files or request write-capable substitutes' : 'modifying task; coordinate checkout access with Codex'}.`,
      'Do not create additional agents yourself; report any need for further delegation to Codex.',
      'Do not treat missing capabilities, denied permissions, or task failures as permission to bypass controls.',
      'If a selected skill requires unavailable tools or host-specific workflow state, stop and report the incompatibility rather than silently omitting it.',
      worker.excludedSkills.length ? `Do not activate or follow these excluded skills: ${worker.excludedSkills.join(', ')}.` : '',
      options.context ? `Relevant parent context and constraints:\n${options.context}` : '',
      skillReads.length ? `Before doing any task work, load every additional required skill through Pi's read tool so its skill/path permission gates apply. Independent reads may share one tool-use response. If any load is denied or fails, stop; never read it with a shell or another workaround.\n${skillReads.join('\n')}` : '',
      `Task:\n${options.task}`,
    ].filter(Boolean).join('\n\n');
    if (worker.state !== 'starting') return;
    // Native activation applies Pi's input/skill gate; extra skills use gated tool reads.
    await this.prompt(worker, selected.length ? `/skill:${selected[0]} ${handoff}` : handoff);
  }

  async prompt(worker, message) {
    worker.state = 'running'; worker.text = ''; worker.error = undefined; worker.submitted = true;
    worker.timer = setTimeout(() => {
      this.fail(worker, new BridgeError('TASK_TIMEOUT', 'Pi task timed out. Reconcile partial work with the user; do not fall back automatically.'));
    }, this.config.taskTimeoutMs);
    worker.timer.unref(); this.change(worker);
    const result = await worker.rpc.request('prompt', { message });
    if (result?.disposition === 'handled' && worker.state === 'running') {
      throw new BridgeError('INPUT_NOT_EXECUTED', 'Pi intercepted the delegated input without an ordinary task run, possibly because a skill was denied. Refusing to report success or fall back.');
    }
  }

  onRecord(worker, event) {
    // RPC streaming records are activity, not changes to the public snapshot.
    const before = [worker.state, worker.text, worker.error, worker.pendingUi.length, worker.notices];
    if (event.type === 'extension_error') {
      this.fail(worker, new BridgeError('EXTENSION_FAILURE', `Pi extension failed: ${event.extensionPath}: ${event.error}`)); return;
    }
    if (event.type === 'extension_ui_request') {
      if (['select', 'confirm', 'input', 'editor'].includes(event.method)) {
        worker.pendingUi.push(event);
        if (worker.state === 'running') worker.state = 'waiting_for_user';
      } else if (event.method === 'notify') {
        worker.notices.push({ type: event.notifyType, message: clip(event.message ?? '', 2000) });
        worker.notices = worker.notices.slice(-5);
      }
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant' && active(worker)) {
      const message = event.message;
      worker.text = clip((Array.isArray(message.content) ? message.content : []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
      if (['error', 'aborted', 'length'].includes(message.stopReason)) worker.error = message.errorMessage ?? `Assistant stopped: ${message.stopReason}`;
      else if (['stop', 'toolUse'].includes(message.stopReason)) worker.error = undefined;
    }
    if (event.type === 'agent_settled' && active(worker)) {
      clearTimeout(worker.timer);
      worker.state = event.aborted ? 'cancelled' : worker.error ? 'failed' : 'completed';
      worker.needsReconciliation = worker.state !== 'completed';
      worker.pendingUi = [];
    }
    if (worker.state !== before[0] || worker.text !== before[1] || worker.error !== before[2]
      || worker.pendingUi.length !== before[3] || worker.notices !== before[4]) this.change(worker);
  }

  fail(worker, error) {
    if (['failed', 'cancelled'].includes(worker.state)) return;
    clearTimeout(worker.timer);
    worker.error = error.message;
    worker.state = 'failed'; worker.pendingUi = [];
    worker.fallbackAllowed = !worker.submitted && error.fallbackAllowed === true;
    worker.needsReconciliation = worker.submitted;
    this.change(worker);
    void worker.rpc?.close();
  }

  get(id) {
    const worker = this.workers.get(id);
    if (!worker) throw new BridgeError('UNKNOWN_WORKER', 'Worker not found in this bridge process. Do not automatically rerun a task after a server restart; inspect its session and partial work first.');
    return worker;
  }

  async status(id, { waitMs = 0, handleUi } = {}) {
    const worker = this.get(id);
    if (waitMs && active(worker) && !worker.pendingUi.length) {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); worker.changes.off('change', done); resolve(); };
        const timer = setTimeout(done, Math.min(waitMs, 15000));
        worker.changes.once('change', done);
      });
    }
    if (worker.pendingUi.length && handleUi && !worker.answering) {
      const request = worker.pendingUi[0];
      worker.answering = true;
      try {
        const response = await handleUi(request);
        if (worker.pendingUi[0] === request && active(worker)) {
          await worker.rpc.send({ ...response, type: 'extension_ui_response', id: request.id });
          worker.pendingUi.shift();
          if (worker.state === 'waiting_for_user' && !worker.pendingUi.length) worker.state = 'running';
        }
      } catch (error) {
        if (worker.rpc && !worker.rpc.failure) {
          try { await worker.rpc.send({ type: 'extension_ui_response', id: request.id, cancelled: true }); } catch {}
        }
        this.fail(worker, new BridgeError('APPROVAL_UNAVAILABLE', `User interaction unavailable: ${error.message}. No automatic fallback.`));
      } finally { worker.answering = false; this.change(worker); }
    }
    return this.snapshot(worker);
  }

  async followUp(id, task) {
    const worker = this.get(id);
    if (worker.discovery || worker.state !== 'completed') throw new BridgeError('NOT_READY', 'Follow-up requires a successfully completed task worker.');
    for (const other of this.workers.values()) {
      if (other !== worker && overlap(other.cwd, worker.cwd) && (other.needsReconciliation || (active(other) && (worker.access === 'write' || other.access === 'write')))) {
        throw new BridgeError('CHECKOUT_BUSY', 'Overlapping work must finish or be reconciled before this follow-up.');
      }
    }
    void this.prompt(worker, `Follow-up from Codex. Keep the existing rules, skill selections, exclusions, and access limits.\n\n${task}`).catch((error) => this.fail(worker, error));
    return this.snapshot(worker);
  }

  async wait(ids, { waitMs = 60000, handleUi, signal } = {}) {
    const workers = [...new Set(ids)].map((id) => this.get(id));
    if (!workers.length) throw new BridgeError('INVALID_WORKERS', 'Select at least one worker.');
    const ready = () => workers.some((worker) => !active(worker) || worker.pendingUi.length);
    if (!ready() && waitMs && !signal?.aborted) {
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          for (const worker of workers) worker.changes.off('change', changed);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        const changed = () => { if (ready()) done(); };
        const timer = setTimeout(done, Math.min(Math.max(waitMs, 0), 60000));
        for (const worker of workers) worker.changes.on('change', changed);
        signal?.addEventListener('abort', done, { once: true });
        if (ready() || signal?.aborted) done();
      });
    }
    const attention = workers.filter((worker) => worker.pendingUi.length);
    // Use the same fail-closed human adapter as pi_status; no model answers.
    for (const worker of attention) await this.status(worker.id, { handleUi });
    return {
      reason: signal?.aborted ? 'interrupted' : attention.length ? 'attention'
        : workers.some((worker) => !active(worker)) ? 'settled' : 'timeout',
      workers: workers.map((worker) => ({
        id: worker.id, state: worker.state, pendingUiCount: worker.pendingUi.length,
        ...(!active(worker) ? { text: clip(worker.text), error: worker.error,
          fallbackAllowed: worker.fallbackAllowed, needsReconciliation: worker.needsReconciliation } : {}),
      })),
    };
  }

  async cancel(id) {
    const worker = this.get(id);
    if (!active(worker)) return this.snapshot(worker);
    clearTimeout(worker.timer);
    worker.state = 'cancelled'; worker.needsReconciliation = worker.submitted; worker.pendingUi = [];
    this.change(worker);
    try {
      if (worker.rpc && !worker.rpc.failure) {
        await worker.rpc.request('clear_queue', {}, 2000);
        await worker.rpc.request('abort', {}, 5000);
      }
    } finally { await worker.rpc?.close(); }
    return this.snapshot(worker);
  }

  async close() {
    this.closed = true; clearInterval(this.reaper);
    await Promise.all([...this.workers.values()].map(async (worker) => {
      if (active(worker)) { try { await this.cancel(worker.id); } catch {} }
      await worker.rpc?.close();
    }));
  }
}
