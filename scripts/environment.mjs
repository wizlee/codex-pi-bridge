import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, json, atomic, sha, run, runPnpm, optional, compatibility } from './manage.mjs';
import { lock } from './launcher.mjs';

export const profileRoot=path.join(root,'profiles/personal');
export const profileFiles=['package.json','pnpm-lock.yaml','.npmrc','profile.json','settings.default.json'];
export async function loadProfile(source=profileRoot) {
  const [pkg,profile,settings]=await Promise.all(['package.json','profile.json','settings.default.json'].map(f=>json(path.join(source,f))));
  assert.equal(pkg.private,true);
  assert.ok(profile.packages.includes(profile.permissionPackage),'Permission extension must be included');
  for(const [name,version] of Object.entries(pkg.dependencies)) {
    assert.match(name,/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/);
    assert.match(version,/^\d+\.\d+\.\d+$/,'Profile dependencies must use exact npm versions');
  }
  assert.equal(new Set(profile.packages).size,profile.packages.length);
  for(const name of [profile.piPackage,...profile.packages])assert.ok(pkg.dependencies[name],`Missing locked package ${name}`);
  const digest=sha(JSON.stringify(await Promise.all(profileFiles.map(async f=>[f,sha(await readFile(path.join(source,f)))]))));
  return {pkg,profile,settings,digest};
}
export function initialSettings(profile,defaults,runtime) {
  // This is a curated public defaults file, never a dump of live user settings.
  const allowed=['defaultProvider','defaultModel','defaultThinkingLevel','defaultTools','enableInstallTelemetry','theme','memory'];
  assert.ok(Object.keys(defaults).every(k=>allowed.includes(k)),'Unreviewed setting in profile');
  return {...defaults,packages:profile.packages.map(name=>path.join(runtime,'node_modules',name))};
}
export async function environmentState(home) {
  assert.ok(path.isAbsolute(home??''),'--home must be absolute');
  const state=await json(path.join(home,'environment.json'));
  assert.equal(state.schema,1);
  assert.equal(state.runtime,path.join(home,'runtime'),'Environment must not move after installation');
  const loaded=await loadProfile(state.runtime);
  assert.equal(loaded.digest,state.profileDigest,'Runtime profile changed');
  assert.deepEqual(state.dependencies,loaded.pkg.dependencies,'Environment dependency manifest changed');
  for(const [name,version] of Object.entries(state.dependencies)) {
    assert.equal((await json(path.join(state.runtime,'node_modules',name,'package.json'))).version,version,`Runtime drift in ${name}`);
  }
  return state;
}
export async function checkEnvironment(home,{candidate=false}={}) {
  const state=await environmentState(home);
  const bun=await run('bun',['--version'],{windowsHide:true});
  const profile=await json(path.join(state.runtime,'profile.json'));
  if(!candidate) assert.equal(bun.stdout.trim(),profile.bun,'Use pinned Bun through mise');
  const args=[path.join(root,'scripts/doctor.mjs'),state.piCli,'--agent',state.agentDir,'--permission',state.permissionPackage];
  if(candidate)args.push('--candidate');
  const result=await run(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1'}});
  const report=JSON.parse(result.stdout);
  for(const command of profile.requiredCommands)assert.ok(report.commands.includes(command),`Missing extension command ${command}`);
  for(const skill of profile.requiredSkills)assert.ok(report.skills.includes(skill),`Missing package skill ${skill}`);
  return {...report,bun:bun.stdout.trim(),profile:profile.name,packages:Object.keys(state.dependencies).length};
}
export async function restore(home,pnpm,{source=profileRoot,candidate=false}={}) {
  assert.ok(path.isAbsolute(home??''),'--home must be absolute. Choose a NEW directory.');
  const loaded=await loadProfile(source);
  const entries=await readdir(home).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const marker=await optional(path.join(home,'profile-owner.json'));
  if(entries.length && !marker)throw new Error('Refusing existing unowned directory; never use your current .pi/agent');
  if(marker && JSON.parse(marker).digest!==loaded.digest)throw new Error('Profile changed. Create a new sibling environment; existing runtime and user state remain intact.');
  return lock(home,async()=>{
    if((await optional(path.join(home,'environment.json'))) && (await optional(path.join(home,'verified.json')))) {
      await environmentState(home);
      const verified=await json(path.join(home,'verified.json'));
      assert.equal(verified.profileDigest,loaded.digest,'Verification marker does not match profile');
      if(!candidate && !verified.report.qualifiedVersions) {
        const report=await checkEnvironment(home);
        await atomic(path.join(home,'verified.json'),{profileDigest:loaded.digest,report});
      }
      return {home,unchanged:true,profileDigest:loaded.digest};
    }
    assert.equal((await runPnpm(pnpm,['--version'])).stdout.trim(),compatibility.pnpm);
    await atomic(path.join(home,'profile-owner.json'),{schema:1,digest:loaded.digest});
    const runtime=path.join(home,'runtime'),agentDir=path.join(home,'agent');
    await mkdir(runtime,{recursive:true});await mkdir(agentDir,{recursive:true});
    for(const file of profileFiles)await cp(path.join(source,file),path.join(runtime,file));
    await runPnpm(pnpm,['install','--frozen-lockfile','--ignore-scripts'],{cwd:runtime,maxBuffer:8*1024*1024});
    const settingsFile=path.join(agentDir,'settings.json');
    if(!(await optional(settingsFile)))await atomic(settingsFile,initialSettings(loaded.profile,loaded.settings,runtime));
    const state={schema:1,profileDigest:loaded.digest,runtime,agentDir,dependencies:loaded.pkg.dependencies,
      piCli:path.join(runtime,'node_modules',loaded.profile.piPackage,'dist/bundle/cli.js'),
      permissionPackage:path.join(runtime,'node_modules',loaded.profile.permissionPackage)};
    // Separate provisional state from the ready marker. Failed checks remain retryable.
    await atomic(path.join(home,'environment.json'),state);
    try {
      const report=await checkEnvironment(home,{candidate});
      await atomic(path.join(home,'verified.json'),{profileDigest:loaded.digest,report});
      return {home,restored:true,profileDigest:loaded.digest,report};
    } catch(error) {
      const {unlink}=await import('node:fs/promises');await unlink(path.join(home,'environment.json'));
      throw error;
    }
  });
}
export async function runEnvironment(home,args) {
  return lock(home,async()=>{
    const state=await environmentState(home);await json(path.join(home,'verified.json'));
    const child=spawn(process.execPath,[state.piCli,...args],{stdio:'inherit',windowsHide:true,
      env:{...process.env,PI_CODING_AGENT_DIR:state.agentDir}});
    const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
    await atomic(path.join(home,'.lock','child.json'),{pid:child.pid});
    for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>child.kill(sig));
    process.exitCode=await exited;
  });
}
async function main() {
  const [command,...args]=process.argv.slice(2),opts={};let piArgs=[];
  for(let i=0;i<args.length;) {
    if(args[i]==='--'){piArgs=args.slice(i+1);break;}
    if(args[i]==='--candidate'){opts.candidate=true;i++;continue;}
    if(!args[i].startsWith('--')||!args[i+1])throw new Error('Expected --key value');
    opts[args[i].slice(2)]=args[i+1];i+=2;
  }
  if(command==='plan') {
    const data=await loadProfile(opts.profile??profileRoot);
    console.log(JSON.stringify({profile:data.profile.name,dependencies:data.pkg.dependencies,settings:data.settings,bun:data.profile.bun,excludedLegacy:data.profile.excludedLegacyPackages},null,2));return;
  }
  const pnpm=opts.pnpm??process.env.npm_execpath;
  let result;
  if(command==='restore')result=await restore(opts.home,pnpm,{source:opts.profile??profileRoot,candidate:opts.candidate});
  else if(command==='doctor')result=await lock(opts.home,async()=>{
    const report=await checkEnvironment(opts.home,{candidate:opts.candidate});
    const state=await environmentState(opts.home);
    await atomic(path.join(opts.home,'verified.json'),{profileDigest:state.profileDigest,report});
    return report;
  });
  else if(command==='run'){await runEnvironment(opts.home,piArgs);return;}
  else throw new Error('Commands: plan, restore, doctor, run');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);if(e.stdout)console.error(e.stdout);if(e.stderr)console.error(e.stderr);process.exitCode=1;});
