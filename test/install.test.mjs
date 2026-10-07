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
 assert.match(r.stdout,/Notes: Agent Notes\nRecording: Pivots, Challenges & fixes\nAsk before each note: yes\n\n--- \/dev\/null\n/);
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
test('agents ask a Yes/No question before each note unless the install is explicitly headless',async t=>{
 const root=await project(t);assert.equal(run(root).status,0);
 const asking=await block(root);
 assert.ok(section(asking,'Ask before writing'));
 for(const want of ['explicit Yes/No selector','Write the note only on Yes','If no user can answer']) assert.ok(asking.includes(want),want);
 const r=run(root,'--headless');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Ask before each note: no \(headless\)\n\n--- AGENTS\.md\n\+\+\+ AGENTS\.md\n/);assert.match(r.stdout,/^-### Ask before writing$/m);
 const headless=await block(root);
 assert.ok(!section(headless,'Ask before writing')&&!headless.includes('Yes/No'),'a headless install drops the question');
 assert.equal(run(root,'--check','--headless').status,0);
 assert.equal(run(root,'--check').status,1,'headless is never inherited: a run without the flag asks again');
 assert.equal(run(root).status,0);assert.equal(await block(root),asking);
});
test('notes are timestamped to the second',async t=>{
 const root=await project(t);assert.equal(run(root,'--record','tactical-direction').status,0);
 const text=await block(root);
 for(const want of ['created: 2026-10-05T14:32:07','updated: 2026-10-05T16:08:41','`YYYY-MM-DDTHH:mm:ss`','date +%Y-%m-%dT%H:%M:%S','never write a date alone','User · 2026-10-05 14:32:07']) assert.ok(text.includes(want),want);
 assert.ok(!/^(created|updated): \d{4}-\d\d-\d\d$/m.test(text),'no date-only properties remain');
});

const update=(root,...args)=>spawnSync(process.execPath,[cli,'update','--project',root,...args],{encoding:'utf8'});
test('update adds a built-in kind and a kind of your own, with its sections and details, and keeps everything else',async t=>{
 const root=await project(t);assert.equal(run(root,'--record','decisions','--add-skip','Anything about the CI provider').status,0);
 const before=await block(root);
 const r=update(root,'--add-kind','gotchas','--add-kind','To-dos=the user says "add X to todo"','--kind-sections','Task, Done when, Links','--kind-details','also keep To-dos/index.md linking every open to-do');
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/Added: Gotchas & lessons \(Agent Notes\/Gotchas\)\nAdded: To-dos \(Agent Notes\/To-dos\)\nRecording: Decisions & tradeoffs, Gotchas & lessons, To-dos\nVerified: AGENTS\.md reads back as written\n\n--- AGENTS\.md\n/);assert.match(r.stdout,/^\+### To-dos$/m);
 const text=await block(root);
 for(const want of ['### Gotchas and lessons','### To-dos','`Agent Notes/To-dos` when: the user says "add X to todo"','`## 1. Task`, `## 2. Done when`, `## 3. Links`.','Also keep To-dos/index.md linking every open to-do.','- Anything about the CI provider','### Ask before writing']) assert.ok(text.includes(want),want);
 assert.ok(!text.includes('## 4. Follow-ups'),'custom sections replace the default ones');
 assert.equal(text.slice(0,text.indexOf('<!-- BEGIN')),before.slice(0,before.indexOf('<!-- BEGIN')));
 const again=update(root,'--add-kind','gotchas','--add-kind','To-dos=the user says "add X to todo"','--kind-sections','Task, Done when, Links','--kind-details','also keep To-dos/index.md linking every open to-do');
 assert.equal(again.status,0,again.stderr);assert.match(again.stdout,/^Already current: /);assert.equal(await block(root),text,'repeating an update changes no bytes');
 assert.equal(run(root).status,0);assert.equal(await block(root),text,'a later full install keeps the new kinds as they are');
});
test('update redefines a kind of your own by name, removes kinds, and refreshes a managed dashboard',async t=>{
 const root=await project(t),vault=await project(t);await fs.mkdir(path.join(vault,'.obsidian'));
 assert.equal(run(root,'--notes-dir',path.join(vault,'Notes'),'--add-kind','Perf wins=a change sped something up','--obsidian-extras').status,0);
 const r=update(root,'--add-kind','Perf wins=a change with before and after timings','--remove-kind','pivots');assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/Changed: Perf wins .*\nRemoved: Pivots\nRecording: Challenges & fixes, Perf wins\nCreated summary: Challenges\/summary\.md\nCreated summary: Perf wins\/summary\.md\nObsidian notes dashboard \(Bases\): update /);
 const text=await block(root);assert.ok(text.includes('when: a change with before and after timings')&&!text.includes('### Pivots'));
 const base=await fs.readFile(path.join(vault,'Notes','Agent Notes.base'),'utf8');assert.ok(base.includes('name: "Perf wins"')&&!base.includes('name: "Pivots"'));
 assert.equal(update(root,'--remove-kind','perf WINS').status,0,'names match in any case');assert.ok(!(await block(root)).includes('Perf wins'));
});
test('update keeps a headless install headless and an asking install asking',async t=>{
 const root=await project(t);assert.equal(run(root,'--headless').status,0);
 assert.equal(update(root,'--add-kind','gotchas').status,0);
 const text=await block(root);assert.ok(!section(text,'Ask before writing')&&section(text,'Gotchas and lessons'));
 assert.equal(run(root,'--check','--headless').status,0);
});
test('update refuses what it cannot do and leaves AGENTS.md untouched',async t=>{
 const root=await project(t),p=path.join(root,'AGENTS.md');
 assert.match(update(root,'--add-kind','gotchas').stderr,/no auto-note-taker block to update; install first/);
 assert.equal(run(root).status,0);const installed=await fs.readFile(p,'utf8');
 assert.match(update(root).stdout,/^Already current: /,'update with nothing named tidies up, and here has nothing to do');
 for(const [args,error] of [[['--notes-dir','x'],/only adds or removes kinds/],[['--headless'],/only adds or removes kinds/],
  [['--remove-kind','nope'],/"nope" is not recorded here/],[['--kind-sections','A'],/must follow --add-kind "NAME=WHEN"/],
  [['--add-kind','gotchas','--kind-details','x'],/must follow --add-kind "NAME=WHEN"/],[['--add-kind','nonsense'],/built-in kind .* or one of your own/],
  [['--add-kind','X=y','--kind-sections','A, a'],/listed twice/],[['--add-kind','X=y','--kind-sections','A `B`'],/backticks/],
  [['--add-kind','X=y','--kind-details','a\nb'],/single line/],[['--add-kind','X=y','--kind-details','x'.repeat(601)],/at most 600/],
  [['--add-kind','Pivots=again'],/listed twice/],[['--remove-kind','pivots','--remove-kind','challenges'],/at least one kind/]]){
  const r=update(root,...args);assert.equal(r.status,1,args.join(' '));assert.match(r.stderr,error,args.join(' '));
 }
 assert.equal(await fs.readFile(p,'utf8'),installed);
});
test('the full installer accepts the new kind flags too',async t=>{
 const root=await project(t);
 const r=run(root,'--add-kind','dead-ends','--add-kind','Perf wins=a change sped something up','--kind-sections','Before, After','--kind-details','Give p50 and p95');
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Recording: Pivots, Challenges & fixes, Dead ends, Perf wins/);
 assert.ok((await block(root)).includes('`## 1. Before`, `## 2. After`.'));
 assert.equal(run(root,'--remove-kind','pivots').status,1,'--remove-kind belongs to update');
});

test('every run shows its diff: --check previews it without writing, and a run that changes nothing shows none',async t=>{
 const root=await project(t),p=path.join(root,'CLAUDE.md');await fs.writeFile(p,'# Rules\n');await fs.symlink('CLAUDE.md',path.join(root,'AGENTS.md'));
 assert.equal(run(root).status,0);const installed=await fs.readFile(p,'utf8');
 const preview=run(root,'--check','--record','decisions');assert.equal(preview.status,1);
 assert.match(preview.stdout,/^Context is missing or out of date\.\n\n--- CLAUDE\.md\n\+\+\+ CLAUDE\.md\n@@ /,'the diff names the file agents read');
 assert.match(preview.stdout,/^-- \*\*Pivots\*\*/m);assert.match(preview.stdout,/^\+- \*\*Decisions & tradeoffs\*\*/m);
 assert.equal(await fs.readFile(p,'utf8'),installed,'--check writes nothing');
 assert.equal(run(root,'--check').stdout,'Context is current.\n');
 assert.equal(run(root).stdout,`Already installed: ${await fs.realpath(p)}\n`);
});
