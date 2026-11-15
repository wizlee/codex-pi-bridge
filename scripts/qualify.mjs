import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, run, runPnpm } from './manage.mjs';
export async function probe(name,fn) {
  try {const result=await fn();return {name,passed:true,output:result.stdout?.slice(-12000)??result};}
  catch(e){return {name,passed:false,error:e.message.slice(0,3000),output:(e.stderr??e.stdout??'').slice(-12000)};}
}
export async function qualify({piCli,agentDir,permissionPackage,candidate=false,pnpm}) {
  const args=[path.join(root,'scripts/doctor.mjs'),piCli,...(agentDir?['--agent',agentDir]:[]),...(permissionPackage?['--permission',permissionPackage]:[]),...(candidate?['--candidate']:[])];
  const gates=[];
  gates.push(await probe('source-and-package-contract',()=>run(process.execPath,[path.join(root,'scripts/check.mjs')],{cwd:root,windowsHide:true})));
  gates.push(await probe('mcp-approvals-protocol-and-regressions',()=>runPnpm(pnpm,['test'],{cwd:root,maxBuffer:8*1024*1024})));
  gates.push(await probe('pi-native-skill-provider-and-permission-contracts',()=>run(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1'}})));
  return {candidate,automatedPassed:gates.every(g=>g.passed),activationAuthorized:false,gates,
    humanChecks:['Visible native form denial and approval in target Codex host','Real Pi permission-extension read/write denial and approval','Interactive extension UI, context-mode doctor, and WakaTime account setup'],
    next:candidate?'Repair failed contracts and requalify. Review and update compatibility pins only after evidence. Candidate mode never enables production activation.':'Review artifact smoke and human checks before activation. Passing automated gates does not grant permissions.'};
}
async function main(){
  const opts={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--candidate'){opts.candidate=true;continue;}if(!key.startsWith('--')||!process.argv[i+1])throw new Error('Expected --key value');opts[key.slice(2)]=process.argv[++i];}
  if(!path.isAbsolute(opts.pi??''))throw new Error('--pi requires absolute CLI path');
  const report=await qualify({piCli:opts.pi,agentDir:opts.agent,permissionPackage:opts.permission,candidate:opts.candidate,pnpm:opts.pnpm??process.env.npm_execpath});
  if(opts.report)await writeFile(opts.report,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));if(!report.automatedPassed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
