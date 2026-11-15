import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, run, runPnpm, inventory, sha } from './manage.mjs';
const pnpm=process.env.npm_execpath;
if(!pnpm?.includes('pnpm')) throw new Error('Run pnpm run package');
await runPnpm(pnpm,['run','check'],{cwd:root});
await runPnpm(pnpm,['test'],{cwd:root,maxBuffer:8*1024*1024});
await mkdir(path.join(root,'dist'),{recursive:true});
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const name=`${pkg.name}-${pkg.version}.tgz`;
const files=await inventory(root), temp=await mkdtemp(path.join(tmpdir(),'bridge-release-'));
try {
  for(const file of Object.keys(files)) {
    const target=path.join(temp,'package',file);await mkdir(path.dirname(target),{recursive:true});await cp(path.join(root,file),target);
  }
  // pnpm 10 pack strips packageManager. Keep exact source metadata in our private artifact.
  await run('tar',['-czf',path.join(root,'dist',name),'-C',temp,'package'],{windowsHide:true});
} finally {await rm(temp,{recursive:true,force:true});}
await writeFile(path.join(root,'dist',name+'.sha256'),sha(await readFile(path.join(root,'dist',name)))+'  '+name+'\n');
await writeFile(path.join(root,'dist','source-manifest.json'),JSON.stringify(files,null,2)+'\n');
console.log(`Created dist/${name} with ${Object.keys(files).length} allowlisted files and SHA256.`);
