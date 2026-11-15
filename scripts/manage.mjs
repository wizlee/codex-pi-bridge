import { access, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { lock } from './launcher.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const run = promisify(execFile);
export const runPnpm = (pnpm,args,options={}) => {
  if(!path.isAbsolute(pnpm??'') || !/\.(c?js|exe)$/i.test(pnpm)) throw new Error('Use absolute pnpm .cjs/.js or .exe path');
  return /\.exe$/i.test(pnpm)?run(pnpm,args,{...options,windowsHide:true}):run(process.execPath,[pnpm,...args],{...options,windowsHide:true});
};
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
export const optional = async file => { try { return await readFile(file, 'utf8'); } catch (e) { if(e.code === 'ENOENT') return ''; throw e; } };
export const sha = value => createHash('sha256').update(value).digest('hex');
export async function atomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  await writeFile(tmp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(tmp, file);
}
export async function inventory(source) {
  const pkg = await json(path.join(source, 'package.json'));
  const files = ['package.json'];
  for (const entry of pkg.files) {
    if (!/^[\w./-]+$/.test(entry) || entry.includes('..')) throw new Error('Unsafe package allowlist');
    const walk = async name => {
      const info = await lstat(path.join(source, name));
      if(info.isSymbolicLink()) throw new Error('Release allowlist contains symlink');
      if (info.isDirectory()) { for (const child of (await readdir(path.join(source,name))).sort()) await walk(name+'/'+child); }
      else files.push(name);
    };
    await walk(entry);
  }
  return Object.fromEntries(await Promise.all(files.sort().map(async f => [f, sha(await readFile(path.join(source,f)))])));
}
export function validateConfig(config) {
  if (!path.isAbsolute(config.piCli ?? '') || typeof config.writesEnabled !== 'boolean'
    || typeof config.requestShapeTelemetry !== 'boolean'
    || !Number.isSafeInteger(config.startupTimeoutMs) || config.startupTimeoutMs < 1000
    || !Number.isSafeInteger(config.taskTimeoutMs) || config.taskTimeoutMs < 1000) throw new Error('Invalid bridge configuration');
}
async function requireManaged(home) {
  if((await optional(path.join(home,'managed.json'))).trim()!=='{"schema":1}') throw new Error('Run init in a NEW managed home first');
}
export async function init(home, piCli) {
  if (!path.isAbsolute(home) || !path.isAbsolute(piCli)) throw new Error('Use absolute home and Pi CLI paths');
  await access(piCli);
  const contents=await readdir(home).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  if(contents.length && (await optional(path.join(home,'managed.json'))).trim()!=='{"schema":1}') throw new Error('Home must be new or already managed. Existing installation remains untouched.');
  return lock(home, async () => {
    await atomic(path.join(home,'managed.json'),'{"schema":1}\n');
    const configFile = path.join(home,'config.json');
    if (!(await optional(configFile))) await atomic(configFile, { piCli, writesEnabled:false, requestShapeTelemetry:false, startupTimeoutMs:45000, taskTimeoutMs:1800000 });
    validateConfig(await json(configFile));
    const launcher = await readFile(path.join(root,'scripts/launcher.mjs'),'utf8');
    const existing = await optional(path.join(home,'launcher.mjs'));
    if (existing && existing !== launcher) throw new Error('Launcher differs. Review launcher migration manually; refusing overwrite.');
    if (!existing) await atomic(path.join(home,'launcher.mjs'),launcher);
    return {home, initialized:true};
  });
}
export async function stage(home, source, pnpm) {
  await requireManaged(home);
  if (!path.isAbsolute(pnpm ?? '')) throw new Error('Pass absolute pnpm.cjs path via --pnpm, or invoke through pnpm run manage');
  return lock(home, async () => {
    if((await runPnpm(pnpm,['--version'])).stdout.trim()!=='10.33.4') throw new Error('Expected pnpm 10.33.4');
    const files = await inventory(source), release = sha(JSON.stringify(files));
    const target = path.join(home,'releases',release);
    const marker = path.join(target,'verified.json');
    if (await optional(marker)) {
      if (JSON.stringify(await inventory(target)) !== JSON.stringify(files)) throw new Error('Staged release modified');
      return {release, staged:true, reused:true};
    }
    // Windows pnpm junctions contain absolute paths. Install at the final pathname;
    // an absent verification marker makes a partial release ineligible for activation.
    await mkdir(target,{recursive:true});
    if((await lstat(target)).isSymbolicLink()) throw new Error('Release directory must not be a symlink');
    for (const file of Object.keys(files)) { await mkdir(path.dirname(path.join(target,file)),{recursive:true}); await cp(path.join(source,file),path.join(target,file)); }
    await runPnpm(pnpm,['install','--frozen-lockfile','--ignore-scripts'],{cwd:target,maxBuffer:8*1024*1024});
    await runPnpm(pnpm,['run','check'],{cwd:target,maxBuffer:8*1024*1024});
    await runPnpm(pnpm,['test'],{cwd:target,maxBuffer:8*1024*1024});
    if(JSON.stringify(await inventory(target)) !== JSON.stringify(files)) throw new Error('Source changed during staging');
    await atomic(marker,{release,files,node:process.version,at:new Date().toISOString()});
    return {release,staged:true};
  });
}
export async function activate(home, release) {
  await requireManaged(home);
  if(!/^[a-f0-9]{64}$/.test(release ?? '')) throw new Error('Expected staged release SHA256');
  return lock(home,async()=>{
    const target=path.join(home,'releases',release), verified=await json(path.join(target,'verified.json'));
    if(sha(JSON.stringify(verified.files))!==release) throw new Error('Verification manifest does not match release ID');
    if(JSON.stringify(await inventory(target)) !== JSON.stringify(verified.files)) throw new Error('Staged release modified');
    const config=await json(path.join(home,'config.json')); validateConfig(config);
    // Actual installed runtime checks run before changing active pointer. No model calls.
    await run(process.execPath,[path.join(target,'scripts/doctor.mjs'),config.piCli],{cwd:target,windowsHide:true,maxBuffer:8*1024*1024});
    const old=await optional(path.join(home,'active.json'));
    const previous=old ? JSON.parse(old).record : null;
    if(previous){ const current=await json(path.join(home,'history',previous+'.json')); if(current.release===release && JSON.stringify(current.desired)===JSON.stringify(config)) return {record:previous,release,unchanged:true}; }
    const record=randomUUID();
    await atomic(path.join(home,'history',record+'.json'),{...config,sessionDir:path.join(home,'sessions'),release,previous,desired:config});
    await atomic(path.join(home,'active.json'),{record});
    return {record,release,activated:true};
  });
}
export async function rollback(home) {
  await requireManaged(home);
  return lock(home,async()=>{
    const {record}=await json(path.join(home,'active.json'));
    const current=await json(path.join(home,'history',record+'.json'));
    if(!current.previous) throw new Error('No prior activation');
    const prior=await json(path.join(home,'history',current.previous+'.json'));
    const target=path.join(home,'releases',prior.release), verified=await json(path.join(target,'verified.json'));
    if(sha(JSON.stringify(verified.files))!==prior.release) throw new Error('Verification manifest does not match rollback release ID');
    if(JSON.stringify(await inventory(target)) !== JSON.stringify(verified.files)) throw new Error('Rollback release modified');
    await run(process.execPath,[path.join(target,'scripts/doctor.mjs'),prior.piCli],{cwd:target,windowsHide:true,maxBuffer:8*1024*1024});
    await atomic(path.join(home,'active.json'),{record:current.previous});
    return {record:current.previous,release:prior.release,rolledBack:true};
  });
}
const markers = kind => [`# BEGIN codex-pi-managed-${kind}`,`# END codex-pi-managed-${kind}`];
export function replaceBlock(text, begin, end, body) {
  const starts=text.split(begin).length-1, ends=text.split(end).length-1;
  if(starts!==ends || starts>1) throw new Error('Ambiguous managed markers');
  if(!starts) return text+(text && !text.endsWith('\n')?'\n':'')+body+'\n';
  const a=text.indexOf(begin), b=text.indexOf(end,a);
  if(b<a) throw new Error('Invalid managed marker order');
  return text.slice(0,a)+body+text.slice(b+end.length);
}
export async function register(home, codex) {
  await requireManaged(home);
  return lock(home,async()=>{
    await json(path.join(home,'active.json'));
    const configFile=path.join(codex,'config.toml'), agentsFile=path.join(codex,'AGENTS.md');
    const original=await optional(configFile), agents=await optional(agentsFile);
    const [begin,end]=markers('mcp');
    const getBlock=(text,a,b)=>text.includes(a)?text.slice(text.indexOf(a),text.indexOf(b)+b.length):null;
    const policyBegin='<!-- BEGIN codex-pi-delegation -->', policyEnd='<!-- END codex-pi-delegation -->';
    const ownershipFile=path.join(home,'registration-owner.json');
    const saved=await optional(ownershipFile);
    const owner=saved?JSON.parse(saved):null;
    if(owner && (owner.configFile!==configFile || owner.agentsFile!==agentsFile)) throw new Error('Managed home already registered to different Codex directory');
    for(const [current,known,previous] of [[getBlock(original,begin,end),owner?.mcp,owner?.previousMcp],[getBlock(agents,policyBegin,policyEnd),owner?.policy,owner?.previousPolicy]]) {
      if(current && current!==known && current!==previous) throw new Error('Unowned or edited managed block. Preserve edits and review migration manually.');
    }
    // Parse stripped config to detect quoted/dotted/table variants without reserializing unrelated bytes.
    const stripped=original.includes(begin)?replaceBlock(original,begin,end,''):original;
    if(parse(stripped).mcp_servers?.pi !== undefined) throw new Error('Existing unowned pi MCP entry. Review migration manually; no settings changed.');
    const block=[begin,'[mcp_servers.pi]',`command = ${JSON.stringify(process.execPath.replaceAll('\\','/'))}`,`args = [${JSON.stringify(path.join(home,'launcher.mjs').replaceAll('\\','/'))}]`, 'enabled = true',end].join('\n');
    const next=replaceBlock(original,begin,end,block); parse(next);
    const policy=(await readFile(path.join(root,'templates/policy.md'),'utf8')).trim();
    const nextAgents=replaceBlock(agents,'<!-- BEGIN codex-pi-delegation -->','<!-- END codex-pi-delegation -->',policy);
    // Full local originals plus proposed bytes allow manual recovery without overwriting newer edits.
    if(next!==original || nextAgents!==agents) {
      await atomic(path.join(home,'registration',randomUUID()+'.json'),{configFile,agentsFile,original,agents,next,nextAgents});
      // Ownership is recorded first so retry after either file replacement converges.
      await atomic(ownershipFile,{configFile,agentsFile,mcp:block,policy,previousMcp:getBlock(original,begin,end),previousPolicy:getBlock(agents,policyBegin,policyEnd)});
      if(next!==original) await atomic(configFile,next);
      if(nextAgents!==agents) await atomic(agentsFile,nextAgents);
    }
    await atomic(ownershipFile,{configFile,agentsFile,mcp:block,policy});
    return {registered:true,restartDesktop:true};
  });
}
export async function unlock(home, reconciled=false) {
  if(!reconciled) throw new Error('Inspect partial work and orphan processes first, then explicitly pass --reconciled true');
  const owner=await json(path.join(home,'.lock','owner.json'));
  const child=await optional(path.join(home,'.lock','child.json'));
  for(const pid of [owner.pid,...(child?[JSON.parse(child).pid]:[])]) {
    if(!Number.isSafeInteger(pid)||pid<=0) throw new Error('Invalid lock PID; manual recovery required');
    try { process.kill(pid,0); } catch(e) { if(e.code==='ESRCH')continue;throw e; }
    throw new Error(`Owner or child PID ${pid} still exists; refusing unlock`);
  }
  await rm(path.join(home,'.lock'),{recursive:true}); return {unlocked:true};
}
async function main() {
  const [command,...args]=process.argv.slice(2), options={};
  for(let i=0;i<args.length;i+=2) {if(!args[i].startsWith('--') || !args[i+1]) throw new Error('Expected --key value'); options[args[i].slice(2)]=args[i+1];}
  const home=options.home; if(!home || !path.isAbsolute(home)) throw new Error('--home must be absolute; choose a NEW managed directory');
  let result;
  if(command==='init') result=await init(home,options.pi);
  else if(command==='stage') result=await stage(home,options.source??root,options.pnpm??(process.env.npm_execpath?.includes('pnpm')?process.env.npm_execpath:undefined));
  else if(command==='activate') result=await activate(home,options.release);
  else if(command==='rollback') result=await rollback(home);
  else if(command==='register') {if(!path.isAbsolute(options.codex??'')) throw new Error('--codex must be absolute'); result=await register(home,options.codex);}
  else if(command==='unlock') result=await unlock(home,options.reconciled==='true');
  else throw new Error('Commands: init, stage, activate, rollback, register, unlock');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);if(e.stdout)console.error(e.stdout);if(e.stderr)console.error(e.stderr);process.exitCode=1;});
