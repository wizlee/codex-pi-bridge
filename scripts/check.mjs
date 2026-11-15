import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { inventory } from './manage.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=await inventory(root);
for(const file of Object.keys(files)) {
  assert.ok(!/(^|\/)(config\.json|sessions|backups|node_modules|\.env[^/]*|auth\.json)(\/|$)/.test(file),`Private file in release: ${file}`);
  if(file.endsWith('.mjs')) execFileSync(process.execPath,['--check',path.join(root,file)],{windowsHide:true});
  const content=await readFile(path.join(root,file),'utf8');
  assert.ok(!/[A-Z]:[/\\]Users[/\\][^/\\\s"']+/i.test(content),`Machine-specific user path in ${file}`);
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.private,true);assert.equal(pkg.license,'UNLICENSED');
assert.equal(pkg.packageManager,'pnpm@10.33.4');
console.log(`Checked ${Object.keys(files).length} allowlisted files; syntax, private defaults, machine paths.`);
