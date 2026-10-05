import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {knownVaults, planExtras, registryPaths, vaultRootOf, writeExtras} from '../lib/obsidian.mjs';

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
  const v = await vault(t), notes = path.join(v, 'Tactical Direction');
  await fs.writeFile(path.join(v, '.obsidian/appearance.json'), JSON.stringify({theme: 'moonstone', enabledCssSnippets: ['mine']}));
  await writeExtras(await planExtras(v, notes));
  const appearance = JSON.parse(await fs.readFile(path.join(v, '.obsidian/appearance.json'), 'utf8'));
  assert.deepEqual(appearance, {theme: 'moonstone', enabledCssSnippets: ['mine', 'tactical-direction']});
  assert.match(await fs.readFile(path.join(notes, 'Tactical Direction.base'), 'utf8'), /file\.hasTag\("tactical-direction"\)/);
  assert.ok((await planExtras(v, notes)).every(s => s.action === 'current'));
  const css = path.join(v, '.obsidian/snippets/tactical-direction.css');
  await fs.writeFile(css, '/* my own */');
  assert.equal((await planExtras(v, notes))[0].action, 'keep (edited by you)');
});

test('--obsidian-extras installs into the notes vault without prompting', async t => {
  const project = await tmp(t), v = await vault(t);
  const r = spawnSync(process.execPath, [cli, '--project', project, '--notes-dir', path.join(v, 'TD'), '--obsidian-extras'], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  await fs.access(path.join(v, '.obsidian/snippets/tactical-direction.css'));
  await fs.access(path.join(v, 'TD/Tactical Direction.base'));
});

test('non-interactive runs never prompt and keep the old output', async t => {
  const project = await tmp(t);
  const r = spawnSync(process.execPath, [cli, '--project', project], {encoding: 'utf8', input: ''});
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Installed: .*AGENTS\.md\nTactical notes: Tactical Direction\n$/);
});
