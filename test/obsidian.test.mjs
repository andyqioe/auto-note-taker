import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {knownVaults, planExtras, registryPaths, vaultRootOf, writeExtras} from '../lib/obsidian.mjs';
import {normalizeSelection, selectedKinds} from '../lib/kinds.mjs';
const chosen = (record = ['tactical-direction', 'challenges']) => selectedKinds(normalizeSelection({record}));

const cli = fileURLToPath(new URL('../bin/install.mjs', import.meta.url));
async function tmp(t) { const p = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ant-vault-'))); t.after(() => fs.rm(p, {recursive: true, force: true})); return p; }
async function vault(t) { const v = await tmp(t); await fs.mkdir(path.join(v, '.obsidian')); return v; }

test('registry paths cover each platform', () => {
  assert.match(registryPaths('/h', 'darwin')[0], /Library\/Application Support\/obsidian\/obsidian\.json$/);
  assert.match(registryPaths('/h', 'win32', {APPDATA: 'C:\\A'})[0], /obsidian[\\/]obsidian\.json$/);
  assert.equal(registryPaths('/h', 'linux', {}).length, 3);
});

test('known vaults skip missing folders and sort by most recent', async t => {
  const a = await vault(t), b = await vault(t), dir = await tmp(t), registry = path.join(dir, 'obsidian.json');
  await fs.writeFile(registry, JSON.stringify({vaults: {1: {path: a, ts: 1}, 2: {path: b, ts: 9}, 3: {path: '/nope', ts: 99}}}));
  assert.deepEqual((await knownVaults([registry, path.join(dir, 'absent.json')])).map(v => v.path), [b, a]);
});

test('vault root is found from a notes folder that does not exist yet', async t => {
  const v = await vault(t);
  assert.equal(vaultRootOf(path.join(v, 'Projects/New/Tactical Direction')), v);
  assert.equal(vaultRootOf(await tmp(t)), null);
});

test('extras enable the snippet, keep existing settings, and never overwrite user edits', async t => {
  const v = await vault(t), notes = path.join(v, 'Agent Notes');
  await fs.writeFile(path.join(v, '.obsidian/appearance.json'), JSON.stringify({theme: 'moonstone', enabledCssSnippets: ['mine']}));
  // A vault that saw seconds-precision times before this install guessed them as text.
  await fs.writeFile(path.join(v, '.obsidian/types.json'), JSON.stringify({types: {owner: 'text', created: 'text'}}));
  await writeExtras(await planExtras(v, notes, chosen()));
  const appearance = JSON.parse(await fs.readFile(path.join(v, '.obsidian/appearance.json'), 'utf8'));
  assert.deepEqual(appearance, {theme: 'moonstone', enabledCssSnippets: ['mine', 'tactical-direction']});
  const types = JSON.parse(await fs.readFile(path.join(v, '.obsidian/types.json'), 'utf8'));
  assert.deepEqual(types, {types: {owner: 'text', created: 'datetime', updated: 'datetime'}}, 'timestamps are typed, other types are kept');
  const base = await fs.readFile(path.join(notes, 'Agent Notes.base'), 'utf8');
  assert.match(base, /file\.hasTag\("tactical-direction"\)/);
  assert.match(base, /name: "Challenges & fixes"/);
  assert.match(base, /note\.status == "workaround"/);
  assert.ok((await planExtras(v, notes, chosen())).every(s => s.action === 'current'));
  // a new choice of kinds updates the managed dashboard, but never one the user edited
  assert.equal((await planExtras(v, notes, chosen(['pivots'])))[2].action, 'update');
  await fs.writeFile(path.join(notes, 'Agent Notes.base'), 'filters: mine\n');
  assert.equal((await planExtras(v, notes, chosen(['pivots'])))[2].action, 'keep (edited by you)');
  const css = path.join(v, '.obsidian/snippets/tactical-direction.css');
  await fs.writeFile(css, '/* my own */');
  assert.equal((await planExtras(v, notes, chosen()))[0].action, 'keep (edited by you)');
});

test('--obsidian-extras installs into the notes vault without prompting', async t => {
  const project = await tmp(t), v = await vault(t);
  const r = spawnSync(process.execPath, [cli, '--project', project, '--notes-dir', path.join(v, 'TD'), '--obsidian-extras'], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  await fs.access(path.join(v, '.obsidian/snippets/tactical-direction.css'));
  await fs.access(path.join(v, 'TD/Agent Notes.base'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(v, '.obsidian/types.json'), 'utf8')), {types: {created: 'datetime', updated: 'datetime'}});
});

test('non-interactive runs never prompt, keep the summary, and show the diff after it', async t => {
  const project = await tmp(t);
  const r = spawnSync(process.execPath, [cli, '--project', project], {encoding: 'utf8', input: ''});
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Installed: .*AGENTS\.md\nNotes: Agent Notes\nRecording: Pivots, Challenges & fixes\nWriting style: none\nLanguage: the language the user writes in\nAsk before each note: yes\n\n--- \/dev\/null\n\+\+\+ AGENTS\.md\n@@ -0,0 \+1,\d+ @@\n\+<!-- BEGIN /);
  assert.ok(!r.stdout.includes('\x1b['), 'piped output has no color codes');
});
