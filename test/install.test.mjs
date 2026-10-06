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
 const args=['--notes-dir','/vault/My Project/Agent Notes','--record','tactical-direction'];
 assert.equal(run(root,...args).status,0);
 const once=await fs.readFile(p,'utf8');assert.match(once,/^# Existing\nDo not delete\./);
 for(const text of ['1. Context','2. Agent Proposal','3. User Disagreement','4. Reconciliation','5. Final agreement','$implementation-summary','verbatim copies','fenced `text` code blocks','User or Agent','/vault/My Project/Agent Notes/Tactical Direction']) assert.ok(once.includes(text),text);
 assert.equal(run(root,...args).status,0);assert.equal(await fs.readFile(p,'utf8'),once);
 assert.equal(run(root,...args,'--check').status,0);
 assert.equal(run(root,'--check').status,0,'with no flags, --check compares against the installed choice');
 assert.equal(run(root,'--check','--record','pivots').status,1);assert.equal(await fs.readFile(p,'utf8'),once);
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

const block=async root=>(await fs.readFile(path.join(root,'AGENTS.md'),'utf8'));
const section=(text,title)=>text.includes(`\n### ${title}\n`);
test('a fresh install records pivots and challenges, each in its own folder, and leaves out the default exclusions',async t=>{
 const root=await project(t);const r=run(root);assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/Notes: Agent Notes\nRecording: Pivots, Challenges & fixes\n$/);
 const text=await block(root);
 assert.ok(section(text,'Pivots')&&section(text,'Challenges and how they were overcome'));
 assert.ok(!section(text,'Tactical direction and disagreements')&&!section(text,'Decisions and tradeoffs'),'kinds not chosen are not rendered');
 for(const want of ['`Agent Notes/Pivots`','`Agent Notes/Challenges`','## 5. Why this fix','Trivial fixes:','Agent mechanics:','Secrets, always']) assert.ok(text.includes(want),want);
 assert.ok(!text.includes('Brainstorming not acted on'));
});
test('flags choose kinds and exclusions, add the user\'s own, and a later run without flags keeps them',async t=>{
 const root=await project(t);
 const r=run(root,'--record','decisions,gotchas','--add-kind','Perf wins=a change measurably sped something up','--skip','none','--add-skip','Anything about the CI provider');
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Recording: Decisions & tradeoffs, Gotchas & lessons, Perf wins/);
 const text=await block(root);
 for(const want of ['### Perf wins','`Agent Notes/Perf wins`','A change measurably sped something up.','Tag: `perf-wins`','- Anything about the CI provider','## 3. Do instead']) assert.ok(text.includes(want),want);
 assert.ok(!text.includes('Routine implementation steps'),'--skip none drops the presets');
 assert.equal(run(root).status,0);assert.equal(await block(root),text,'a bare re-run keeps the choice byte for byte');
 assert.equal(run(root,'--add-kind','Security=a change touched auth or secrets').status,0);
 assert.match(await block(root),/### Perf wins[\s\S]*### Security/,'--add-kind extends the previous choice');
});
test('an install from before note kinds keeps recording tactical direction where its notes already are',async t=>{
 const root=await project(t),p=path.join(root,'AGENTS.md');
 await fs.writeFile(p,'# Rules\n\n<!-- BEGIN tactical-direction-context -->\n## Tactical direction and disagreements\n\nAlways record any user disagreement or tactical direction in `Notes/TD` at project scope.\n<!-- END tactical-direction-context -->\n');
 const r=run(root);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Notes: Notes\/TD\nRecording: Tactical direction\n/);
 const text=await block(root);
 assert.ok(text.includes('Record every user disagreement or tactical direction in `Notes/TD`:'),'tactical notes stay in the old folder, not a new subfolder');
 assert.ok(!section(text,'Pivots'));assert.match(text,/^# Rules\n\n<!-- BEGIN/);
 assert.equal(run(root,'--record','tactical-direction,pivots').status,0);
 const both=await block(root);assert.ok(both.includes('in `Notes/TD`:')&&both.includes('`Notes/TD/Pivots`'));
});
test('bad selections fail before anything is written',async t=>{
 const root=await project(t),p=path.join(root,'AGENTS.md');await fs.writeFile(p,'Keep\n');
 for(const args of [['--record','pivots,nope'],['--skip','everything'],['--record','none'],['--add-kind','no equals sign'],['--add-kind','X=sneaky --> <!-- BEGIN tactical-direction-context -->'],['--add-skip','two\nlines'],['--record','pivots','--add-kind','Pivots=again']]){
  const r=run(root,...args);assert.equal(r.status,1,args.join(' '));assert.match(r.stderr,/auto-note-taker: /);
 }
 assert.equal(await fs.readFile(p,'utf8'),'Keep\n');
});
