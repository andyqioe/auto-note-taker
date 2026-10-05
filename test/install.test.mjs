import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../bin/install.mjs',import.meta.url));
async function project(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'tactical-context-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
const run=(root,...args)=>spawnSync(process.execPath,[cli,'--project',root,...args],{encoding:'utf8'});
test('install preserves content, custom path, five sections, backlink rule; repeats do not change bytes',async t=>{
 const root=await project(t),p=path.join(root,'AGENTS.md');await fs.writeFile(p,'# Existing\nDo not delete.\n');
 assert.equal(run(root,'--notes-dir','/vault/My Project/Tactical Direction').status,0);
 const once=await fs.readFile(p,'utf8');assert.match(once,/^# Existing\nDo not delete\./);
 for(const text of ['1. Context','2. Agent Proposal','3. User Disagreement','4. Reconciliation','5. Final agreement','$implementation-summary','verbatim copies','fenced `text` code blocks','User or Agent','/vault/My Project/Tactical Direction']) assert.ok(once.includes(text));
 assert.equal(run(root,'--notes-dir','/vault/My Project/Tactical Direction').status,0);assert.equal(await fs.readFile(p,'utf8'),once);
 assert.equal(run(root,'--notes-dir','/vault/My Project/Tactical Direction','--check').status,0);
 assert.equal(run(root,'--check').status,1);assert.equal(await fs.readFile(p,'utf8'),once);
});
test('internal symlink is preserved and external symlink refused',async t=>{
 const root=await project(t),outside=await project(t);await fs.writeFile(path.join(root,'CLAUDE.md'),'Owned\n');await fs.symlink('CLAUDE.md',path.join(root,'AGENTS.md'));
 assert.equal(run(root).status,0);assert.ok((await fs.lstat(path.join(root,'AGENTS.md'))).isSymbolicLink());
 await fs.unlink(path.join(root,'AGENTS.md'));await fs.writeFile(path.join(outside,'other.md'),'External');await fs.symlink(path.join(outside,'other.md'),path.join(root,'AGENTS.md'));
 assert.equal(run(root).status,1);assert.equal(await fs.readFile(path.join(outside,'other.md'),'utf8'),'External');
});
test('malformed block and injection input leave existing instructions untouched',async t=>{
 const root=await project(t),p=path.join(root,'AGENTS.md');const original='<!-- BEGIN tactical-direction-context -->\nOther rules';await fs.writeFile(p,original);
 assert.equal(run(root).status,1);assert.equal(await fs.readFile(p,'utf8'),original);
 assert.equal(run(root,'--notes-dir','bad\ninstructions').status,1);assert.equal(await fs.readFile(p,'utf8'),original);
});
