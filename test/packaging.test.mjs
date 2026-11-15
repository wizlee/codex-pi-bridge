import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { init, register, activate, rollback, inventory, sha, atomic, json, replaceBlock, unlock } from '../scripts/manage.mjs';
import { lock } from '../scripts/launcher.mjs';

async function fixture(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'bridge-package-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const home=path.join(dir,'managed'),pi=path.join(dir,'pi.mjs');await writeFile(pi,'');
  await init(home,pi);return {dir,home,pi};
}
async function release(home,text) {
  const source=path.join(home,'fixture-'+text);await mkdir(path.join(source,'scripts'),{recursive:true});
  await writeFile(path.join(source,'package.json'),JSON.stringify({name:'fixture',files:['scripts']}));
  await writeFile(path.join(source,'scripts','doctor.mjs'),`// Model-free lifecycle fixture ${text}\n`);
  const files=await inventory(source), id=sha(JSON.stringify(files));
  const target=path.join(home,'releases',id);await mkdir(path.dirname(target),{recursive:true});
  const {rename}=await import('node:fs/promises');await rename(source,target);await atomic(path.join(target,'verified.json'),{files});return id;
}
test('fresh init defaults safe, repeats preserve explicit settings, existing live directory refused',async t=>{
  const {dir,home,pi}=await fixture(t);const config=await json(path.join(home,'config.json'));
  assert.equal(config.writesEnabled,false);assert.equal(config.requestShapeTelemetry,false);
  await atomic(path.join(home,'config.json'),{...config,writesEnabled:true,custom:'preserve'});
  await init(home,pi);assert.equal((await json(path.join(home,'config.json'))).custom,'preserve');
  const existing=path.join(dir,'existing');await mkdir(existing);await writeFile(path.join(existing,'config.json'),'keep');
  await assert.rejects(init(existing,pi),/new or already managed/);assert.equal(await readFile(path.join(existing,'config.json'),'utf8'),'keep');
});
test('registration preserves unrelated bytes and newer edits, repeats idempotently, refuses edited owned policy',async t=>{
  const {dir,home}=await fixture(t),codex=path.join(dir,'codex');await mkdir(codex);
  const original='# User settings\r\nmodel = "keep"\r\n[mcp_servers.other]\r\ncommand = "keep"\r\n';
  await writeFile(path.join(codex,'config.toml'),original);await writeFile(path.join(codex,'AGENTS.md'),'User instructions.\n');
  await atomic(path.join(home,'active.json'),{record:'fixture'});
  await register(home,codex);const first=await readFile(path.join(codex,'config.toml'),'utf8');assert.ok(first.startsWith(original));
  await register(home,codex);assert.equal(await readFile(path.join(codex,'config.toml'),'utf8'),first);
  await writeFile(path.join(codex,'config.toml'),first+'\n# newer user edit\n');await register(home,codex);
  assert.ok((await readFile(path.join(codex,'config.toml'),'utf8')).endsWith('# newer user edit\n'));
  const agents=await readFile(path.join(codex,'AGENTS.md'),'utf8');await writeFile(path.join(codex,'AGENTS.md'),agents.replace('Use Pi MCP','Custom edit. Use Pi MCP'));
  await assert.rejects(register(home,codex),/edited managed block/);
});
test('unowned quoted MCP table and unowned policy never overwritten; marker ambiguity rejected',async t=>{
  const {dir,home}=await fixture(t),codex=path.join(dir,'codex');await mkdir(codex);await atomic(path.join(home,'active.json'),{});
  const text='[mcp_servers."pi"]\ncommand="old"\n';await writeFile(path.join(codex,'config.toml'),text);
  await assert.rejects(register(home,codex),/unowned pi MCP/);assert.equal(await readFile(path.join(codex,'config.toml'),'utf8'),text);
  await writeFile(path.join(codex,'config.toml'),'');const policy='<!-- BEGIN codex-pi-delegation -->\nMine\n<!-- END codex-pi-delegation -->';await writeFile(path.join(codex,'AGENTS.md'),policy);
  await assert.rejects(register(home,codex),/Unowned/);assert.equal(await readFile(path.join(codex,'AGENTS.md'),'utf8'),policy);
  assert.throws(()=>replaceBlock('BEGIN x BEGIN END','BEGIN','END','new'),/Ambiguous/);
});
test('activation and rollback restore code and active config together; desired config and sessions survive',async t=>{
  const {home}=await fixture(t),a=await release(home,'a'),b=await release(home,'b');
  const first=await activate(home,a);assert.equal((await activate(home,a)).unchanged,true);
  const config=await json(path.join(home,'config.json'));await atomic(path.join(home,'config.json'),{...config,taskTimeoutMs:90000});
  await mkdir(path.join(home,'sessions'));await writeFile(path.join(home,'sessions','keep.jsonl'),'keep');
  await activate(home,b);await rollback(home);
  assert.equal((await json(path.join(home,'active.json'))).record,first.record);
  assert.equal((await json(path.join(home,'history',first.record+'.json'))).taskTimeoutMs,config.taskTimeoutMs);
  assert.equal((await json(path.join(home,'config.json'))).taskTimeoutMs,90000);
  assert.equal(await readFile(path.join(home,'sessions','keep.jsonl'),'utf8'),'keep');
});
test('running lock blocks activation and registration; tampered release cannot activate',async t=>{
  const {home,dir}=await fixture(t),a=await release(home,'a');
  await lock(home,async()=>{await assert.rejects(activate(home,a),/locked/);await assert.rejects(register(home,dir),/locked/);await assert.rejects(unlock(home,true),/still exists/);});
  await writeFile(path.join(home,'releases',a,'scripts','doctor.mjs'),'changed');
  await assert.rejects(activate(home,a),/modified/);
  await assert.rejects(unlock(home),/Inspect partial work/);
});
