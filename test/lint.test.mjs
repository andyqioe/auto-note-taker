import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../bin/install.mjs', import.meta.url));
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], {cwd, encoding: 'utf8'});
const note = body => `---
status: resolved
tags: [challenge, queue/retry]
---

# The lock now expires with the lease

> [!success|banner] Resolved 2026-10-05 16:08:41
> The job lock now expires with the lease of the worker.

## 1. Symptom

${body}

> [!quote|user] User · 2026-10-05 14:32:07
> \`\`\`text
> It should have been released; it is being utilized by the crashed worker.
> \`\`\`
`;

async function project(t, ...installArgs) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lint-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const r = run(root, '--project', root, ...installArgs);
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(root, 'Agent Notes', 'Challenges', 'queue');
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, 'clean.md'), note('A worker that crashes no longer blocks its retries.'));
  await fs.writeFile(path.join(dir, 'passive.md'), note('The retry was blocked by the lock.'));
  return root;
}

test('lint checks every note against the installed style, skips quotes and summaries, and changes nothing', async t => {
  const root = await project(t, '--style', 'ste');
  const before = await fs.readFile(path.join(root, 'Agent Notes', 'Challenges', 'queue', 'passive.md'), 'utf8');
  const r = run(root, 'lint');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, [
    'Agent Notes/Challenges/queue/passive.md: 1 warning in 2 sentences',
    '  L13 passive: "was blocked": name who does it, in the active voice - "The retry was blocked by the lock."',
    '1 warning in 2 notes (ASD-STE100). A warning is a question: fix the sentence, or keep it when the rule does not apply.',
    ''].join('\n'), 'the summary.md the install wrote and the quoted message draw nothing');
  assert.equal(await fs.readFile(path.join(root, 'Agent Notes', 'Challenges', 'queue', 'passive.md'), 'utf8'), before);
  assert.equal(run(root, 'lint', '--strict').status, 1);
  assert.equal(run(root, 'lint', '--strict', 'Agent Notes/Challenges/queue/clean.md').status, 0, 'a named note is the only one checked');
});

test('lint --format json reports each note, and --style checks against other styles', async t => {
  const root = await project(t, '--style', 'ste');
  const reports = JSON.parse(run(root, 'lint', '--format', 'json').stdout);
  assert.deepEqual(reports.map(r => [r.file, r.sentences, r.warnings.map(w => w.rule)]),
    [['Agent Notes/Challenges/queue/clean.md', 2, []], ['Agent Notes/Challenges/queue/passive.md', 2, ['passive']]]);
  await fs.writeFile(path.join(root, 'Agent Notes', 'Challenges', 'queue', 'nobanner.md'), '# No banner\n\nThe worker stops.\n');
  const bluf = run(root, 'lint', '--style', 'bluf');
  assert.match(bluf.stdout, /^Agent Notes\/Challenges\/queue\/nobanner\.md: 1 warning in 1 sentence\n {2}L1 banner: open with the banner callout/m);
  assert.doesNotMatch(bluf.stdout, /passive/, 'BLUF does not check the voice');
});

test('lint explains what it cannot do', async t => {
  const root = await project(t);
  let r = run(root, 'lint');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no writing style to check against; install one, or pass --style/);
  r = run(root, 'lint', '--style', 'apa');
  assert.match(r.stderr, /unknown style apa/);
  r = run(root, 'lint', '--format', 'yaml');
  assert.match(r.stderr, /--format takes json/);
  const empty = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lint-')));
  t.after(() => fs.rm(empty, {recursive: true, force: true}));
  assert.match(run(empty, 'lint', '--style', 'ste').stderr, /no notes folder is installed here; name the notes to check/);
});
