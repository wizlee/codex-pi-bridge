// Real packed-artifact lifecycle check. No model calls or live registration.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { init, stage, activate, register, rollback, run, json, inventory, atomic } from './manage.mjs';

const args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2) opts[args[i].replace(/^--/,'')]=args[i+1];
assert.ok(path.isAbsolute(opts.tarball??''),'--tarball must be absolute');
let environment={};
if(opts.environment) {
  assert.ok(path.isAbsolute(opts.environment));
  const state=await json(path.join(opts.environment,'environment.json')),verified=await json(path.join(opts.environment,'verified.json'));
  assert.ok(verified.report?.qualifiedVersions && verified.profileDigest===state.profileDigest,'Strict environment qualification required');
  opts.pi=state.piCli;environment={agentDir:state.agentDir,permissionPackage:state.permissionPackage};
}
assert.ok(path.isAbsolute(opts.pi??''),'Pass --pi or --environment with an absolute path');
const pnpm=opts.pnpm??process.env.npm_execpath;
const temp=await mkdtemp(path.join(tmpdir(),'bridge-artifact-smoke-'));
let client;
try {
  const entries=(await run('tar',['-tzf',opts.tarball])).stdout.trim().split(/\r?\n/);
  assert.ok(entries.every(f=>f.startsWith('package/') && !f.includes('..') && !/(^|\/)(node_modules|sessions|backups|config\.json|\.env[^/]*)(\/|$)/.test(f)),'Unexpected private or unsafe archive entry');
  await run('tar',['-xzf',opts.tarball,'-C',temp]);
  const source=path.join(temp,'package'),home=path.join(temp,'managed'),codex=path.join(temp,'codex');
  const expected=Object.keys(await inventory(source)).map(f=>'package/'+f).sort();
  assert.deepEqual(entries.filter(f=>!f.endsWith('/')).sort(),expected,'Archive contains files outside package allowlist');
  await init(home,opts.pi,environment);const config=await json(path.join(home,'config.json'));
  assert.equal(config.writesEnabled,false);assert.equal(config.requestShapeTelemetry,false);
  const first=await stage(home,source,pnpm);assert.equal((await stage(home,source,pnpm)).reused,true);
  const firstActive=await activate(home,first.release);await register(home,codex);await register(home,codex);
  const registered=await readFile(path.join(codex,'config.toml'),'utf8');assert.ok(registered.includes('launcher.mjs'));
  client=new Client({name:'packaged-launcher-smoke',version:'1'},{capabilities:{}});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(home,'launcher.mjs')],stderr:'pipe'});
  transport.stderr?.on('data',chunk=>process.stderr.write(chunk));
  await client.connect(transport);
  await assert.rejects(activate(home,first.release),/locked/);
  const call=async(name,args)=>JSON.parse((await client.callTool({name,arguments:args})).content[0].text);
  const blocked=await call('pi_delegate',{cwd:source,task:'must never submit',access:'write'});assert.equal(blocked.code,'APPROVAL_NOT_VERIFIED');
  let state=await call('pi_discover',{cwd:source});
  for(let i=0;i<60 && state.state==='starting';i++) state=await call('pi_status',{id:state.id,waitMs:1000});
  assert.equal(state.state,'completed',state.error);assert.ok(state.sessionFile.startsWith(path.join(home,'sessions')));
  await client.close();client=null;
  // Allow stdio EOF shutdown to release lifetime lock before management resumes.
  for(let i=0;i<100 && (await readdir(home)).includes('.lock');i++) await new Promise(r=>setTimeout(r,20));
  assert.ok(!(await readdir(home)).includes('.lock'),'Launcher did not release lock after clean shutdown');
  await writeFile(path.join(source,'README.md'),(await readFile(path.join(source,'README.md'),'utf8'))+'\nIsolated upgrade fixture.\n');
  const second=await stage(home,source,pnpm);assert.notEqual(second.release,first.release);
  await atomic(path.join(home,'config.json'),{...config,taskTimeoutMs:90000});await activate(home,second.release);
  await rollback(home);assert.equal((await json(path.join(home,'active.json'))).record,firstActive.record);
  assert.equal((await json(path.join(home,'history',firstActive.record+'.json'))).taskTimeoutMs,config.taskTimeoutMs);
  assert.equal((await json(path.join(home,'config.json'))).taskTimeoutMs,90000);
  assert.equal(await readFile(path.join(codex,'config.toml'),'utf8'),registered);
  const report={ok:true,archiveAllowlist:true,freshDefaults:true,stageReuse:true,realLauncherMcpDiscovery:true,externalSessions:true,runningActivationRefused:true,writeGateRefusedBeforeSubmission:true,upgrade:true,rollbackCodeAndConfig:true,registrationIdempotent:true,modelCalls:0,firstRelease:first.release,secondRelease:second.release};
  if(opts.report)await writeFile(opts.report,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await client?.close();await rm(temp,{recursive:true,force:true});}
