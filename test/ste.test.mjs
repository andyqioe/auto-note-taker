import test from 'node:test';
import assert from 'node:assert/strict';
import {check, steConfig} from '../lib/ste.mjs';

const rules = (text, config) => check(text, config).warnings.map(w => w.rule);

test('each STE rule warns on a sentence that breaks it', () => {
  const cases = {
    length: 'The worker reads the queue and then it writes every record to the store and the store sends one reply to the client for each record that it got.',
    passive: 'The charge is sent to the bank.',
    tense: 'The hook has recorded the base.',
    hedge: 'A retry might charge the customer twice.',
    ing: 'The worker stops after restarting the queue.',
    phrasal: 'The agent can set up the desk.',
    word: 'The tool can utilize the cache.',
    semicolon: 'The worker stops; the queue keeps the job.',
    instructions: 'Run the tests, then open the desk.',
  };
  for (const [rule, sentence] of Object.entries(cases)) assert.ok(rules(sentence).includes(rule), rule);
});

test('an instruction may have 20 words and a description 25', () => {
  assert.ok(rules('Run ' + Array(19).fill('the').join(' ') + ' tests.').includes('length'));
  assert.ok(!rules('The ' + Array(19).fill('worker').join(' ') + ' stops.').includes('length'), '21 words, descriptive');
});

test('a paragraph may have six sentences', () => {
  const paragraph = n => Array.from({length: n}, (_, i) => `The worker stops queue ${i}.`).join('\n');
  assert.ok(rules(paragraph(7)).includes('paragraph'));
  assert.ok(!rules(paragraph(6)).includes('paragraph'));
});

test('headings, labels, code and tables stay quiet', () => {
  const text = `# Heading with a long title that is not a sentence and must not count as one at all

The client sends a charge to the bank.
If the build fails, read the first error.

- **Risk**: the worker crashes, and nobody knows what the bank got.
- **Mechanism**: \`send_charge_after_recording()\` saves the intent first (\`src/pay.py:40-42\`).

\`\`\`python
# code is never checked: it is being utilized and has been set up
x = 1
\`\`\`

| a table row is skipped | it is being utilized |
`;
  assert.deepEqual(rules(text), []);
});

test('quoted words, inline code and ste: off regions are mentions, not uses', () => {
  assert.deepEqual(rules('Write "use", not "utilize", and "start", not "set up".'), []);
  assert.deepEqual(rules('The `existing_cache` keeps a string for the logging setting.'), []);
  assert.deepEqual(rules('<!-- ste: off -->\nIt has been utilized; it might be sent.\n<!-- ste: on -->\nThe tool stops.'), []);
});

test('abbreviations do not split sentences', () => {
  const report = check('The page keeps names, e.g. a sha, in the label.');
  assert.equal(report.sentences, 1);
  assert.ok(report.warnings.some(w => w.rule === 'word'));
});

test('line numbers point at the sentence', () => {
  assert.deepEqual(check('The tool stops.\nThe charge is sent.\n\n- A retry might fail.').warnings.map(w => [w.rule, w.line]), [['passive', 2], ['hedge', 4]]);
});

test('a note is checked for its own prose only: not its properties, callout titles, links or verbatim quotes', () => {
  const note = `---
status: resolved
aliases: ["Retries have been piling up because the lock is being held"]
---

# Retries have been piling up because the lock is being held

> [!success|banner] Resolved 2026-10-05 16:08:41
> The lock now expires with the lease of the worker.
> The old lock was held by a dead worker.

## 1. Symptom

See [[Challenges/queue/retry/lockLease|Retries are being blocked]] and [the log](<../logs/run 1.md>).

> [!quote|user] User · 2026-10-05 14:32:07
> \`\`\`text
> It should have been released; it is being kept by the crashed worker.
> \`\`\`
>
> That would be utilized by everyone.

> [!quote|agent]- Agent · 2026-10-05 14:33:15
> The lock has been held, I think.

- [ ] The retry is sent twice when the lock stays.
`;
  const report = check(note);
  assert.deepEqual(report.warnings.map(w => [w.rule, w.line]), [['passive', 10], ['passive', 26]]);
  assert.equal(report.sentences, 4);
});

test('a configuration turns rules off and changes the limits', () => {
  const plain = {rules: ['length', 'passive'], limits: {descriptive: 30, instruction: 25, paragraph: 6}, words: {}};
  const long = 'The ' + Array(26).fill('worker').join(' ') + ' stops.';
  assert.ok(rules(long, steConfig).includes('length'));
  assert.ok(!rules(long, plain).includes('length'));
  assert.deepEqual(rules('A retry might utilize the cache; it stops.', plain), []);
});
