import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

export class PiRpc extends EventEmitter {
  constructor({ cli, cwd, args = [], timeoutMs = 45000, env = process.env }) {
    super();
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.stderr = '';
    this.failure = null;
    this.closing = false;
    this.child = spawn(process.execPath, [cli, '--mode', 'rpc', ...args], {
      cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.exited = new Promise((resolve) => { this.resolveExit = resolve; });
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    this.child.stdout.on('data', (chunk) => {
      buffer += decoder.write(chunk);
      if (buffer.length > 16 * 1024 * 1024) {
        this.fail(new Error('Pi RPC record exceeded 16 MiB')); return;
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { this.receive(JSON.parse(line)); }
        catch (error) { this.fail(new Error(`Invalid Pi RPC output: ${error.message}`)); }
      }
    });
    this.child.stdout.on('end', () => {
      buffer += decoder.end();
      if (buffer.trim() && !this.closing) this.fail(new Error('Pi closed stdout with an incomplete JSONL record'));
    });
    this.child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk.toString()).slice(-12000); });
    this.child.stdin.on('error', (error) => { if (!this.closing) this.fail(error); });
    this.child.on('error', (error) => {
      this.fail(error); this.resolveExit();
    });
    this.child.on('close', (code, signal) => {
      this.fail(new Error(`Pi exited (${code ?? signal}). ${this.stderr}`));
      this.resolveExit();
    });
  }

  receive(record) {
    if (record.type === 'response') {
      const pending = this.pending.get(record.id);
      if (pending) {
        this.pending.delete(record.id);
        clearTimeout(pending.timer);
        if (record.success) pending.resolve(record.data);
        else pending.reject(new Error(`Pi ${record.command}: ${record.error ?? 'request rejected'}`));
      }
    }
    this.emit('record', record);
    this.emit(record.type, record);
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer); pending.reject(error);
    }
    this.pending.clear();
    if (!this.closing) this.emit('failure', error);
  }

  send(record) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(record)}\n`, (error) => error ? reject(error) : resolve());
    });
  }

  request(type, fields = {}, timeoutMs = this.timeoutMs) {
    if (this.failure) return Promise.reject(this.failure);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`Pi ${type} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ ...fields, type, id }).catch((error) => {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      });
    });
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      this.child.stdin.end();
      const timer = setTimeout(() => this.child.kill(), 2000);
      try { await this.exited; }
      finally { clearTimeout(timer); }
    })();
    return this.closePromise;
  }
}
