// Deliberately dependency-free. Copied once into a new managed home.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export async function lock(home, action) {
  await mkdir(home, { recursive: true });
  const dir = path.join(home, '.lock');
  try { await mkdir(dir); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('Managed home locked. Stop bridge first. After a crash, inspect lock owner and use unlock.'); throw e; }
  try {
    await writeFile(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    return await action();
  } finally { await rm(dir, { recursive: true }); }
}

export async function launch(home) {
  await lock(home, async () => {
    const { record } = JSON.parse(await readFile(path.join(home, 'active.json'), 'utf8'));
    if (!/^[a-f0-9-]+$/.test(record)) throw new Error('Invalid activation record');
    const recordFile = path.join(home, 'history', record + '.json');
    const state = JSON.parse(await readFile(recordFile, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(state.release)) throw new Error('Invalid release');
    const cwd = path.join(home, 'releases', state.release);
    const child = spawn(process.execPath, [path.join(cwd, 'src/server.mjs')], {
      cwd, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, PI_BRIDGE_CONFIG: recordFile },
    });
    await writeFile(path.join(home,'.lock','child.json'),JSON.stringify({pid:child.pid}));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); resolve(); });
    });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch(path.dirname(fileURLToPath(import.meta.url))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
