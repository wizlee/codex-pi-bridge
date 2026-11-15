import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadProfile, initialSettings, restore, environmentState, profileFiles, profileRoot } from '../scripts/environment.mjs';
import { init, json, atomic, doctorArgs } from '../scripts/manage.mjs';
import { probe } from '../scripts/qualify.mjs';
import { packageUpdate } from '../scripts/updates.mjs';
import { PiRpc } from '../src/rpc.mjs';

test('personal profile locks active packages and generates only portable defaults',async()=>{
  const {pkg,profile,settings}=await loadProfile();
  assert.equal(profile.packages.length,8);assert.ok(!profile.packages.includes('pi-extmgr'));
  assert.equal(pkg.dependencies['@majorgilles/pi-grill-me'],'0.3.0');
  const result=initialSettings(profile,settings,path.resolve('runtime'));
  assert.equal(result.packages.length,8);assert.equal(result.enableInstallTelemetry,false);
  assert.throws(()=>initialSettings(profile,{auth:'do not export'},path.resolve('runtime')),/Unreviewed/);
});
test('restoration refuses existing user state and changed profile without touching files',async t=>{
  const home=await mkdtemp(path.join(tmpdir(),'pi-profile-test-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(path.join(home,'auth.json'),'private fixture');
  await assert.rejects(restore(home,'unused'),/unowned/);
  assert.equal(await readFile(path.join(home,'auth.json'),'utf8'),'private fixture');
  await atomic(path.join(home,'profile-owner.json'),{digest:'different'});
  await assert.rejects(restore(home,'unused'),/new sibling environment/);
});
test('managed bridge pairs with isolated agent without enabling writes, diagnostic override cannot reach activation',async t=>{
  const home=await mkdtemp(path.join(tmpdir(),'pi-pair-test-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const cli=path.join(home,'pi.mjs');await writeFile(cli,'');
  const agentDir=path.join(home,'agent'),permissionPackage=path.join(home,'permission');
  const bridge=path.join(home,'bridge');await init(bridge,cli,{agentDir,permissionPackage});
  const config=await json(path.join(bridge,'config.json'));assert.equal(config.agentDir,agentDir);assert.equal(config.writesEnabled,false);
  assert.deepEqual(doctorArgs(home,{...config,candidate:true}),[path.join(home,'scripts/doctor.mjs'),cli,'--agent',agentDir,'--permission',permissionPackage]);
});
test('RPC child receives selected agent directory independently of parent settings',async t=>{
  const home=await mkdtemp(path.join(tmpdir(),'pi-rpc-env-test-'));let rpc;
  t.after(async()=>{await rpc?.close();await rm(home,{recursive:true,force:true});});
  const cli=path.join(home,'echo.mjs');await writeFile(cli,`import {createInterface} from 'node:readline'; for await(const line of createInterface({input:process.stdin})){const r=JSON.parse(line);console.log(JSON.stringify({type:'response',id:r.id,command:r.type,success:true,data:{agentDir:process.env.PI_CODING_AGENT_DIR}}));}`);
  rpc=new PiRpc({cli,cwd:home,env:{...process.env,PI_CODING_AGENT_DIR:home}});
  assert.equal((await rpc.request('get_state')).agentDir,home);
});
test('environment version drift and moved paths fail before process launch',async t=>{
  const home=await mkdtemp(path.join(tmpdir(),'pi-drift-test-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const runtime=path.join(home,'runtime');await mkdir(runtime,{recursive:true});
  for(const file of profileFiles)await cp(path.join(profileRoot,file),path.join(runtime,file));
  const loaded=await loadProfile(runtime),name=Object.keys(loaded.pkg.dependencies)[0];
  await atomic(path.join(runtime,'node_modules',name,'package.json'),{version:'0.0.0'});
  await atomic(path.join(home,'environment.json'),{schema:1,runtime,profileDigest:loaded.digest,dependencies:loaded.pkg.dependencies});
  await assert.rejects(environmentState(home),/Runtime drift/);
  await atomic(path.join(home,'environment.json'),{schema:1,runtime:home,dependencies:{}});
  await assert.rejects(environmentState(home),/must not move/);
});
test('upgrade diagnostics preserve failed gate and registry problems rather than promoting candidates',async()=>{
  const result=await probe('provider-contract',async()=>{throw new Error('Payload changed');});
  assert.equal(result.passed,false);assert.equal(result.name,'provider-contract');assert.match(result.error,/Payload changed/);
  const update=await packageUpdate('fixture','1.0.0',async()=>({ok:true,json:async()=>({'dist-tags':{latest:'2.0.0'},versions:{'1.0.0':{deprecated:'Old API'}}})}));
  assert.equal(update.updateAvailable,true);assert.equal(update.deprecated,'Old API');
  assert.match((await packageUpdate('fixture','1.0.0',async()=>({ok:false,status:503}))).error,/503/);
});
