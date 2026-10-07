import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {migrateKind, suspectName, verifyInstall} from '../lib/cleanup.mjs';
import {planInstall, writeInstall} from '../lib/install.mjs';
import {nestedName, rewriteLinks} from '../lib/layout.mjs';

const cli = fileURLToPath(new URL('../bin/install.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/Tactical Direction.base', import.meta.url));
async function tmp(t) { const p = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ant-cleanup-'))); t.after(() => fs.rm(p, {recursive: true, force: true})); return p; }
const cmd = (root, ...args) => spawnSync(process.execPath, [cli, ...args, '--project', root], {encoding: 'utf8'});
const read = p => fs.readFile(p, 'utf8');
async function write(p, text) { await fs.mkdir(path.dirname(p), {recursive: true}); await fs.writeFile(p, text); }
const note = (tag, body = '') => `---\nstatus: current\ntags: [${tag}, pool/orders]\n---\n\n# A note\n\n${body}\n`;
const exists = p => fs.stat(p).then(() => true, () => false);

test('a name that holds instructions is split into a short name and its instructions', () => {
  assert.ok(suspectName('To-dos - if user specifies "add to todo" create a summary page') && suspectName('x'.repeat(41)) && suspectName('Perf: anything faster'));
  assert.ok(!suspectName('To-dos') && !suspectName('Perf wins') && !suspectName('Gotchas & lessons'));
  assert.deepEqual(migrateKind({name: 'To-dos - if user says "add to todo" keep a summary page', when: '"add X to todo"'}),
    {name: 'To-dos', when: '"add X to todo"', details: 'if user says "add to todo" keep a summary page'});
  assert.equal(migrateKind({name: 'Perf: anything faster', when: 'x', details: 'give timings'}).details, 'anything faster; give timings');
});

test('a flat name maps to at most two folders and a file', () => {
  assert.equal(nestedName('pool-hostMode-fencingDesign.md'), path.join('pool', 'hostMode', 'fencingDesign.md'));
  assert.equal(nestedName('qmail-routing.md'), path.join('qmail', 'routing.md'));
  assert.equal(nestedName('a-b-c-d.md'), path.join('a', 'b', 'c-d.md'));
  for (const name of ['single.md', 'Agent Notes.md', 'has space-x.md', 'notes.txt']) assert.equal(nestedName(name), null, name);
});

test('links follow a moved note: wikilinks get its path, table pipes stay escaped, relative links are recomputed', () => {
  const moved = new Map([['/v/D/pool-host-fencing.md', '/v/D/pool/host/fencing.md']]);
  const byName = new Map([['pool-host-fencing', '/v/D/pool/host/fencing.md'], ['D/pool-host-fencing', '/v/D/pool/host/fencing.md']]);
  const text = [
    'See [[pool-host-fencing]], [[pool-host-fencing#Why|why]], ![[pool-host-fencing]], [[D/pool-host-fencing]] and [[elsewhere]].',
    '| 1 | [[pool-host-fencing]] | [[pool-host-fencing\\|F]] | [[pool-host-fencing|G]] |',
    '[a](</v/D/pool-host-fencing.md>) [r](../D/pool-host-fencing.md#x) [w](https://e.com/pool-host-fencing.md) [o](</x/results.md:9>)'].join('\n');
  const out = rewriteLinks(text, {oldFile: '/v/T/a-b-c.md', newFile: '/v/T/a/b/c.md', moved, byName, linkRoot: '/v'}).split('\n');
  assert.equal(out[0], 'See [[D/pool/host/fencing|pool-host-fencing]], [[D/pool/host/fencing#Why|why]], ![[D/pool/host/fencing]], [[D/pool/host/fencing|pool-host-fencing]] and [[elsewhere]].');
  assert.equal(out[1], '| 1 | [[D/pool/host/fencing\\|pool-host-fencing]] | [[D/pool/host/fencing\\|F]] | [[D/pool/host/fencing\\|G]] |');
  assert.equal(out[2], '[a](</v/D/pool/host/fencing.md>) [r](../../../D/pool/host/fencing.md#x) [w](https://e.com/pool-host-fencing.md) [o](</x/results.md:9>)');
});

test('update migrates an old install: short kind name, notes in folders, links and tags rewritten, leftovers removed', async t => {
  const vault = await tmp(t), root = path.join(vault, 'proj'), notes = path.join(vault, 'Notes');
  await fs.mkdir(path.join(vault, '.obsidian'), {recursive: true}); await fs.mkdir(root);
  const long = 'To-dos - if user says "add to todo" keep a summary page';
  assert.equal(cmd(root, '--notes-dir', notes, '--record', 'decisions,gotchas', '--add-kind', `${long}=the user says add X to todo`, '--yes').status, 0);
  const longTag = 'to-dos-if-user-says-add-to-todo-keep-a-summary-page', longDir = path.join(notes, 'To-dos - if user says add to todo keep a summary page');
  await write(path.join(longDir, 'qmail-api-routing.md'), note(longTag, 'Decided in [[pool-hostMode-fencing]].'));
  await write(path.join(longDir, 'osrs-todos.md'), note(longTag, '| 1 | [[qmail-api-routing]] |'));
  await write(path.join(notes, 'Decisions', 'pool-hostMode-fencing.md'), note('decision', 'See [routing](<../To-dos - if user says add to todo keep a summary page/qmail-api-routing.md>).'));
  await write(path.join(notes, 'Decisions', 'pool', 'hostMode', 'kept.md'), note('decision'));
  await write(path.join(notes, 'Decisions', 'Free form note.md'), note('decision'));
  await write(path.join(vault, 'Journal.md'), 'Today: [[pool-hostMode-fencing]]\n');
  await fs.mkdir(path.join(notes, 'Gotchas', 'empty'), {recursive: true});
  await fs.copyFile(fixture, path.join(notes, 'Tactical Direction.base'));
  const before = await read(path.join(root, 'AGENTS.md'));

  const dry = cmd(root, 'update', '--remove-kind', 'gotchas', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^Dry run, nothing written: /);
  assert.match(dry.stdout, /Would migrate: "To-dos - if user says "add to todo" keep a summary page" → To-dos/);
  assert.match(dry.stdout, /Would move 3 notes into folders:\n  Decisions\/pool-hostMode-fencing\.md → Decisions\/pool\/hostMode\/fencing\.md\n/);
  assert.match(dry.stdout, /Would remove: Tactical Direction\.base \(dashboard from an earlier version/);
  assert.match(dry.stdout, /Would remove: Gotchas\/ \(empty folder of "Gotchas & lessons", no longer recorded\)/);
  assert.equal(await read(path.join(root, 'AGENTS.md')), before, 'a dry run writes nothing');
  assert.ok(await exists(path.join(longDir, 'osrs-todos.md')));

  const r = cmd(root, 'update', '--remove-kind', 'gotchas');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Verified: AGENTS\.md reads back as written; 3 moved and \d+ edited notes are in place/);
  const agents = await read(path.join(root, 'AGENTS.md'));
  assert.ok(agents.includes('### To-dos\n'));
  assert.match(agents, /How to write these notes, in the user's words .*: If user says "add to todo" keep a summary page\./);
  assert.ok(!(await exists(longDir)), 'the old kind folder is gone once empty');
  const routing = await read(path.join(notes, 'To-dos', 'qmail', 'api', 'routing.md'));
  assert.match(routing, /^tags: \[to-dos, pool\/orders\]$/m, 'the old long tag is replaced');
  assert.ok(routing.includes('[[Notes/Decisions/pool/hostMode/fencing|pool-hostMode-fencing]]'));
  assert.ok((await read(path.join(notes, 'To-dos', 'osrs', 'todos.md'))).includes('| 1 | [[Notes/To-dos/qmail/api/routing\\|qmail-api-routing]] |'));
  assert.ok((await read(path.join(notes, 'Decisions', 'pool', 'hostMode', 'fencing.md'))).includes('[routing](<../../../To-dos/qmail/api/routing.md>)'));
  assert.equal(await read(path.join(vault, 'Journal.md')), 'Today: [[Notes/Decisions/pool/hostMode/fencing|pool-hostMode-fencing]]\n', 'links from elsewhere in the vault follow');
  assert.ok(await exists(path.join(notes, 'Decisions', 'Free form note.md')) && await exists(path.join(notes, 'Decisions', 'pool', 'hostMode', 'kept.md')));
  assert.ok(!(await exists(path.join(notes, 'Tactical Direction.base'))) && !(await exists(path.join(notes, 'Gotchas'))));

  assert.match(cmd(root, 'update').stdout, /^Already current: /, 'a second update has nothing left to do');
  assert.equal(cmd(root, '--check').status, 0);
});

test('cleanup never removes what it does not own: an edited old dashboard and a folder with a note stay', async t => {
  const root = await tmp(t), notes = path.join(root, 'Agent Notes');
  assert.equal(cmd(root, '--record', 'pivots,gotchas', '--yes').status, 0);
  await write(path.join(notes, 'Gotchas', 'tool', 'quirk.md'), note('gotcha'));
  await write(path.join(notes, 'Tactical Direction.base'), (await read(fixture)) + '# my edit\n');
  assert.equal(cmd(root, 'update', '--remove-kind', 'gotchas').status, 0);
  assert.ok(await exists(path.join(notes, 'Gotchas', 'tool', 'quirk.md')) && await exists(path.join(notes, 'Tactical Direction.base')));
});

test('a write that does not read back as intended is undone and reported', async t => {
  const root = await tmp(t), file = path.join(root, 'AGENTS.md');
  await fs.writeFile(file, '# Mine\n');
  const plan = await planInstall(root, 'Agent Notes', undefined);
  assert.ok(await writeInstall(plan));
  await verifyInstall(plan);
  await fs.writeFile(file, plan.next.replace('### Record', '### Recorded'));
  await assert.rejects(verifyInstall(plan), /failed verification \(the file does not hold what was written; the block does not match what its settings render\); it was restored/);
  assert.equal(await read(file), '# Mine\n');
});
