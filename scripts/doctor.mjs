import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Bridge } from '../src/bridge.mjs';
import { qualifyProviderPayload } from '../src/worker-skill-loading.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const load=async file=>JSON.parse(await readFile(file,'utf8'));
export async function doctor(piCli,{cwd=root,agentDir=process.env.PI_CODING_AGENT_DIR??path.join(homedir(),'.pi','agent')}={}) {
  assert.ok(path.isAbsolute(piCli??''),'Pi CLI path must be absolute');
  const manifest=await load(path.join(root,'compatibility.json'));
  assert.equal(process.versions.node,manifest.node,'Untested Node version');
  assert.ok(manifest.platforms.includes(`${process.platform}-${process.arch}`),'Unqualified operating system or architecture');
  const piRoot=path.resolve(path.dirname(piCli),'../..');
  const pkg=await load(path.join(piRoot,'package.json'));
  assert.equal(pkg.name,manifest.pi.package,'Unexpected Pi package');
  assert.equal(pkg.version,manifest.pi.version,'Untested Pi version. Requalify compatibility before activation.');
  const permission=await load(path.join(agentDir,'npm/node_modules/@gotgenes/pi-permission-system/package.json'));
  assert.equal(permission.version,manifest.permissionExtension.version,'Untested permission extension version or location');
  const temp=await mkdtemp(path.join(tmpdir(),'pi-bridge-doctor-'));
  const protectedFiles=['settings.json','AGENTS.md','trust.json','extensions/pi-permission-system/config.json'].map(f=>path.join(agentDir,f));
  const snapshot=()=>Promise.all(protectedFiles.map(async f=>{try{return createHash('sha256').update(await readFile(f)).digest('hex');}catch(e){if(e.code==='ENOENT')return null;throw e;}}));
  const before=await snapshot();
  let bridge;
  try {
    const skill={name:'bridge-check',description:'Model-free compatibility probe',filePath:path.join(temp,'SKILL.md'),baseDir:temp,source:'path',disableModelInvocation:false};
    await writeFile(skill.filePath,'---\nname: bridge-check\ndescription: Model-free compatibility probe\n---\nKeep all human permission gates intact.\n');
    const {AgentSession}=await import(pathToFileURL(path.join(piRoot,'dist/core/agent-session.js')));
    const {buildSystemPrompt}=await import(pathToFileURL(path.join(piRoot,'dist/core/system-prompt.js')));
    // Run installed native expansion, prompt formatter, and actual provider serializer.
    // The hook throws before transport. Synthetic credentials only; no auth storage loaded.
    const expanded=AgentSession.prototype._expandSkillCommand.call({resourceLoader:{getSkills:()=>({skills:[skill]})}},'/skill:bridge-check Check');
    assert.ok(expanded.startsWith('<skill name="bridge-check"'),'Native skill expansion changed');
    const prompt=buildSystemPrompt({cwd:temp,skills:[skill],selectedTools:['read']});
    const require=createRequire(pathToFileURL(piCli));
    let aiDir;
    for(const search of require.resolve.paths('@earendil-works/pi-ai')) {
      try { const candidate=path.join(search,'@earendil-works/pi-ai'); await readFile(path.join(candidate,'package.json')); aiDir=path.join(candidate,'dist'); break; }
      catch(e) { if(e.code!=='ENOENT') throw e; }
    }
    assert.ok(aiDir,'Cannot locate installed Pi provider runtime');
    const {stream}=await import(pathToFileURL(path.join(aiDir,'api/openai-codex-responses.js')));
    let captured;
    const token='e30.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'model-free-fixture'}})).toString('base64url')+'.fixture';
    const sentinel='BRIDGE_MODEL_FREE_STOP';
    const result=await stream({id:'compatibility-probe',provider:'openai-codex',api:'openai-codex-responses',input:['text'],baseUrl:'http://127.0.0.1:1',compat:{}},
      {messages:[{role:'system',content:prompt,timestamp:0},{role:'user',content:[{type:'text',text:expanded}],timestamp:1}]},
      {apiKey:token,retryCount:0,onPayload:payload=>{captured=qualifyProviderPayload(payload);throw new Error(sentinel);}}).result();
    assert.ok(result.errorMessage?.includes(sentinel),`Provider hook did not stop before transport: ${result.errorMessage}`);
    assert.ok(captured?.instructions?.includes('Already injected native skills: bridge-check'),'Skill optimization ineffective against actual installed provider payload');
    assert.ok(!captured.instructions.includes("Use the read tool to load a skill's file when the task matches its description."),'Unconditional skill hint remains');
    bridge=new Bridge({root,config:{piCli,writesEnabled:false,requestShapeTelemetry:false,startupTimeoutMs:45000,taskTimeoutMs:60000,sessionDir:path.join(temp,'sessions')}});
    let state=await bridge.discover(cwd);
    const deadline=Date.now()+60000;
    while(state.state==='starting' && Date.now()<deadline) state=await bridge.status(state.id,{waitMs:1000});
    assert.equal(state.state,'completed',state.error??'Discovery did not complete');
    assert.ok(state.extensionCommands.includes('permission-system'),'Permission extension did not register');
    return {ok:true,node:process.version,pi:pkg.version,permissionExtension:permission.version,actualProviderSkillQualification:true,modelCalls:0,discovery:true};
  } finally {
    await bridge?.close();
    await rm(temp,{recursive:true,force:true});
    assert.deepEqual(await snapshot(),before,'Standalone Pi configuration changed during diagnostics');
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) doctor(process.argv[2]).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack);process.exitCode=1;});
