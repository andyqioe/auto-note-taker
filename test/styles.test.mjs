import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {installedConfig, renderBlock} from '../lib/install.mjs';
import {normalizeSelection} from '../lib/kinds.mjs';
import {check} from '../lib/ste.mjs';
import {lintConfig, styles, unstyledExample, validateLanguage} from '../lib/styles.mjs';

const render = (sel, opts) => renderBlock('Agent Notes', normalizeSelection(sel), opts);
const section = (block, heading) => {
  const at = block.indexOf(`\n${heading}\n`);
  if (at < 0) return '';
  const next = block.slice(at + heading.length + 2).search(/\n#{2,3} /);
  return next < 0 ? block.slice(at) : block.slice(at, at + heading.length + 2 + next);
};

test('with no style and no language, the block has no style section and stores neither', async () => {
  const block = await render({});
  assert.ok(!block.includes('### Writing style'));
  assert.ok(block.includes('- Write prose in the language the user writes in; keep the required section headings as given.'));
  assert.doesNotMatch(block.split('\n')[1], /"styles"|"ownStyle"|"language"/);
});

test('chosen styles, an own style and a language read back exactly as they were chosen', async () => {
  const block = await render({styles: ['google', 'ste'], ownStyle: '  keep each note under one screen ', language: 'English'});
  const {selection} = installedConfig(block);
  assert.deepEqual([selection.styles, selection.ownStyle, selection.language], [['ste', 'google'], 'keep each note under one screen', 'English']);
  assert.equal(await renderBlock('Agent Notes', selection), block, 'the stored choice renders the same bytes again');
});

test('each style renders its own rules, in catalog order, after the shared lead', async () => {
  const block = await render({styles: styles.map(s => s.id)});
  const headings = [...block.matchAll(/^#### (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(headings, ['ASD-STE100 (Simplified Technical English)', 'Plain language (ISO 24495-1)',
    'BLUF (bottom line up front, Army AR 25-50)', 'Google developer documentation style']);
  const lead = section(block, '### Writing style');
  assert.match(lead, /Never change verbatim quotes, code, identifiers/);
  assert.match(lead, /Where two of these styles disagree, follow the stricter rule\./);
  assert.match(lead, /auto-note-taker lint "<note path>"/);
});

test('English-only styles say how to treat other languages unless notes are always English', async () => {
  const note = /The rules of ASD-STE100 and Google developer style are for English\./;
  assert.match(await render({styles: ['ste', 'google', 'plain']}), note);
  assert.match(await render({styles: ['ste', 'google'], language: 'Deutsch'}), note);
  assert.doesNotMatch(await render({styles: ['ste', 'google'], language: 'english'}), note);
  assert.doesNotMatch(await render({styles: ['plain', 'bluf']}), /are for English/);
});

test('one style alone has no stricter-rule line; a style with nothing to check has no lint line', async () => {
  const own = await render({ownStyle: 'write like a lab notebook'});
  assert.match(own, /#### Your own style\n\nIn the user's words .*: Write like a lab notebook\./);
  assert.doesNotMatch(section(own, '### Writing style'), /stricter rule|auto-note-taker lint/);
  assert.doesNotMatch(await render({styles: ['ste']}), /stricter rule/);
});

test('a named language replaces the match-the-user rule and keeps quotes in their own language', async () => {
  const block = await render({language: 'Português (Brasil)'});
  assert.match(block, /- Write note prose in Português \(Brasil\), whatever language the user writes in;.*keep verbatim quotes in their original language\./);
  assert.ok(!block.includes('the language the user writes in;'));
});

test('unknown styles, unsafe own styles and odd language names are refused', () => {
  assert.throws(() => normalizeSelection({styles: ['ste', 'apa']}), /unknown style apa; choose from ste, plain, bluf, google/);
  assert.throws(() => normalizeSelection({ownStyle: 'end -->'}), /HTML comment markers/);
  assert.throws(() => normalizeSelection({ownStyle: 'two\nlines'}), /single line/);
  assert.throws(() => normalizeSelection({ownStyle: 'x'.repeat(601)}), /at most 600/);
  for (const bad of ['English`', 'a/b', 'x'.repeat(41), '-->']) assert.ok(validateLanguage(bad), bad);
  for (const good of ['English', 'Português (Brasil)', '中文', 'Scottish Gaelic']) assert.equal(validateLanguage(good), '', good);
});

test('several styles check every rule of each and the stricter limit', () => {
  const both = lintConfig(['plain', 'ste']);
  assert.equal(both.limits.descriptive, 25);
  assert.ok(both.rules.includes('ing') && both.words.utilize);
  assert.equal(lintConfig(['plain']).limits.descriptive, 30);
  assert.deepEqual(lintConfig([]), null);
  assert.deepEqual(lintConfig(['bluf']).rules, ['banner', 'paragraph']);
});

test('each style follows its own rules: its rule file and its wizard example draw no warning', async () => {
  for (const s of styles) {
    const config = {...lintConfig([s.id]), rules: lintConfig([s.id]).rules.filter(r => r !== 'banner')};
    const rules = await fs.readFile(new URL(`../context/styles/${s.id}.md`, import.meta.url), 'utf8');
    assert.deepEqual(check(rules, config).warnings, [], `${s.id}.md`);
    assert.deepEqual(check(s.example, config).warnings, [], `${s.id} example`);
  }
  assert.ok(check(unstyledExample, lintConfig(['ste'])).warnings.length, 'the unstyled example shows what STE changes');
});

test('a re-run and an update keep the installed styles and language', async t => {
  const {spawnSync} = await import('node:child_process');
  const os = await import('node:os'), path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'styles-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const cli = new URL('../bin/install.mjs', import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--project', root], {encoding: 'utf8'});
  await fs.writeFile(path.join(root, 'AGENTS.md'), (await render({styles: ['bluf'], language: 'English'})) + '\n');
  const before = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal(run('--check').status, 0, 'the installed choice is current');
  assert.equal(run().status, 0);
  assert.equal(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), before, 'a bare re-run changes no bytes');
  const r = run('update', '--add-kind', 'decisions');
  assert.equal(r.status, 0, r.stderr);
  const {selection} = installedConfig(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'));
  assert.deepEqual([selection.record, selection.styles, selection.language], [['pivots', 'challenges', 'decisions'], ['bluf'], 'English']);
});
