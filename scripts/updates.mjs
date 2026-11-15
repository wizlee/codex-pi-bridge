import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, json } from './manage.mjs';
export async function packageUpdate(name,pinned,fetcher=fetch) {
  try {
    const response=await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}`,{signal:AbortSignal.timeout(20000),headers:{accept:'application/json'}});
    if(!response.ok)throw new Error(`Registry HTTP ${response.status}`);
    const metadata=await response.json(),latest=metadata['dist-tags']?.latest;
    if(typeof latest!=='string')throw new Error('Registry has no latest dist-tag');
    return {name,pinned,latest,updateAvailable:latest!==pinned,deprecated:metadata.versions?.[pinned]?.deprecated??null,
      changelog:metadata.repository?.url??metadata.homepage??null};
  }catch(e){return {name,pinned,error:e.message};}
}
export async function updates(fetcher=fetch) {
  const [bridge,profile,compat]=await Promise.all(['package.json','profiles/personal/package.json','compatibility.json'].map(f=>json(path.join(root,f))));
  const declarations={...bridge.dependencies,...profile.dependencies,pnpm:compat.pnpm,bun:compat.bun};
  const packages=await Promise.all(Object.entries(declarations).map(([name,pin])=>packageUpdate(name,pin,fetcher)));
  return {generated:new Date().toISOString(),packages,nodePin:compat.node,
    codex:{action:'Review installed Codex desktop/CLI release notes and repeat native human approval checks; npm dependencies do not pin Codex.'},
    next:'Create a candidate branch. Update exact pins and lockfiles. Restore into a NEW environment, qualify contracts, repair failures, then review activation. No changes made.'};
}
async function main(){
  const report=await updates();const index=process.argv.indexOf('--report');
  if(index>=0)await writeFile(process.argv[index+1],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.packages.some(p=>p.error))process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
