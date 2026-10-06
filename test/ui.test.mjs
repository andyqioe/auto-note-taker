import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {browsePrompt, checklistPrompt, completePath, confirmPrompt, displayPath, fit, inputPrompt, parseKeys, selectPrompt, visibleLength} from '../lib/ui.mjs';

const press = (prompt, ...keys) => keys.reduce((s, k) => prompt.key(s, typeof k === 'string' ? {name: 'char', ch: k} : k), prompt.init());
const k = name => ({name});
const tree = {'/v': ['Journal', 'Projects'], '/v/Projects': ['Demo App', 'Website'], '/v/Projects/Website': [], '/': ['v']};
const browse = opts => browsePrompt({start: '/v/Projects', read: d => { if (!tree[d]) throw Object.assign(new Error('x'), {code: 'ENOENT'}); return tree[d]; }, vault: d => d === '/v', ...opts});

test('parseKeys splits escape sequences, control keys and text', () => {
  assert.deepEqual(parseKeys(Buffer.from('\x1b[Aab\r\x7f\x1b[D\t\x03')).map(k => k.name + (k.ch ?? '')),
    ['up', 'chara', 'charb', 'enter', 'backspace', 'left', 'tab', 'ctrl-c']);
});

test('fit and displayPath never exceed the width and keep the end of paths visible', () => {
  const line = '\x1b[1m' + 'x'.repeat(100) + '\x1b[22m';
  assert.equal(visibleLength(fit(line, 40)), 40);
  const shown = displayPath('/a/very/long/path/that/ends/in/My Project', 24);
  assert.equal([...shown].length, 24);
  assert.ok(shown.endsWith('My Project'));
  assert.equal(displayPath(os.homedir() + '/x'), '~/x');
});

test('select wraps, jumps by number, and reports back only when allowed', () => {
  const p = selectPrompt({title: 'T', options: [{label: 'a', value: 1}, {label: 'b', value: 2}, {label: 'c', value: 3}], back: true});
  assert.equal(press(p, k('up')).cursor, 2);
  assert.equal(press(p, k('down'), k('enter')).done, 2);
  assert.equal(press(p, '3').done, 3);
  assert.equal(press(p, k('escape')).back, true);
});

test('browser lands on the first subfolder, so repeated enter drills down', () => {
  const p = browse();
  let s = p.init();
  assert.equal(s.cursor, 2);
  s = p.key(s, k('enter'));
  assert.equal(s.dir, '/v/Projects/Demo App');
});

test('browser goes up to the parent with the cursor on the folder it left', () => {
  const p = browse();
  const s = press(p, k('left'));
  assert.equal(s.dir, '/v');
  assert.equal(s.vaultRoot, true);
  assert.equal(s.cursor, 2 + tree['/v'].indexOf('Projects'));
});

test('browser filter narrows folders, backspace edits it, escape clears it', () => {
  const p = browse();
  let s = press(p, 'w', 'e');
  assert.equal(s.filter, 'we');
  assert.equal(p.key(s, k('enter')).dir, '/v/Projects/Website');
  assert.equal(p.key(s, k('backspace')).filter, 'w');
  assert.equal(p.key(s, k('escape')).filter, '');
  assert.equal(p.key(p.key(s, k('escape')), k('escape')).back, true);
});

test('browser chooses the current folder or asks for a new one inside it', () => {
  const p = browse();
  assert.equal(press(p, k('home'), k('enter')).done, '/v/Projects');
  assert.deepEqual(press(p, k('home'), k('down'), k('enter')).done, {newFolderIn: '/v/Projects'});
  const noNew = browse({allowNew: false});
  assert.equal(noNew.view(noNew.init(), 80).some(l => l.includes('New folder')), false);
});

test('browser reports unreadable folders instead of crashing', () => {
  const p = browse({start: '/missing'});
  const s = p.init();
  assert.ok(s.error);
  assert.ok(p.view(s, 80).length > 0);
});

test('every browser line fits a narrow terminal', () => {
  const p = browse({start: '/v'});
  for (const line of p.view(p.init(), 40)) assert.ok(visibleLength(line) <= 40, line);
});

test('input validates on enter and confirm answers to y and n', () => {
  const p = inputPrompt({title: 'T', validate: v => v ? '' : 'required'});
  assert.equal(press(p, k('enter')).error, 'required');
  assert.equal(press(p, 'a', 'b', k('backspace'), k('enter')).done, 'a');
  const yes = confirmPrompt({title: 'T'});
  assert.equal(press(yes, 'n').done, false);
  assert.equal(press(yes, k('enter')).done, true);
});

test('tab completion completes a unique folder and stops at a shared prefix', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-complete-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(path.join(root, 'Notes Vault'));
  await fs.mkdir(path.join(root, 'Notebook'));
  await fs.mkdir(path.join(root, 'Projects'));
  assert.equal(completePath(root + '/Pro'), root + '/Projects/');
  assert.equal(completePath(root + '/No'), root + '/Note');
  assert.equal(completePath(root + '/zzz'), root + '/zzz');
});

test('checklist ticks with space, keeps option order, enforces a minimum, and offers an add row', () => {
  const p = checklistPrompt({title: 'Record', min: 1, add: 'Add your own…', options: [
    {label: 'A', value: 'a', checked: true}, {label: 'B', value: 'b'}, {label: 'C', value: 'c'}]});
  assert.deepEqual(press(p, k('down'), k('down'), ' ', k('up'), ' ', k('enter')).done, {checked: ['a', 'b', 'c']});
  assert.equal(press(p, ' ', k('enter')).error, 'tick at least 1 with space');
  const add = press(p, k('end'), ' ', k('enter'));
  assert.deepEqual(add.done, {add: true, checked: ['a']}, 'space on the add row ticks nothing');
  assert.equal(p.transient(add), true);
  assert.match(p.summary(press(p, k('down'), ' ', k('enter')))(80), /Record.*A, B/);
  for (const width of [40, 79]) for (const line of p.view(p.init(), width)) assert.ok(visibleLength(line) <= width, line);
  const long = checklistPrompt({title: 'T', options: ['alpha', 'bravo', 'charlie', 'delta'].map(v => ({label: v, value: v, checked: true}))});
  assert.match(long.summary(press(long, k('enter')))(22), /alpha, \+3 more$/, 'a long summary drops whole labels, never cuts one');
});
