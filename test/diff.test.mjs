import test from 'node:test';
import assert from 'node:assert/strict';
import {lineDiff, unifiedDiff} from '../lib/diff.mjs';

const lines = n => Array.from({length: n}, (_, i) => `l${i + 1}`).join('\n') + '\n';
test('a replaced line reads old then new, with three lines of context and a hunk header', () => {
  const {lines: out, added, removed} = unifiedDiff(lines(10), lines(10).replace('l5\n', 'five\n'));
  assert.deepEqual(out, ['--- AGENTS.md', '+++ AGENTS.md', '@@ -2,7 +2,7 @@', ' l2', ' l3', ' l4', '-l5', '+five', ' l6', ' l7', ' l8']);
  assert.deepEqual([added, removed], [1, 1]);
});
test('nearby changes share a hunk and distant ones get their own', () => {
  const near = unifiedDiff(lines(20), lines(20).replace('l5\n', 'x\n').replace('l9\n', 'y\n')).lines;
  assert.equal(near.filter(l => l.startsWith('@@')).length, 1);
  const far = unifiedDiff(lines(30), lines(30).replace('l5\n', 'x\n').replace('l25\n', 'y\n')).lines;
  assert.deepEqual(far.filter(l => l.startsWith('@@')), ['@@ -2,7 +2,7 @@', '@@ -22,7 +22,7 @@']);
});
test('a new file diffs against /dev/null, an append starts after the last line, and no change is no diff', () => {
  assert.deepEqual(unifiedDiff('', 'a\nb\n', {name: 'CLAUDE.md'}).lines, ['--- /dev/null', '+++ CLAUDE.md', '@@ -0,0 +1,2 @@', '+a', '+b']);
  assert.deepEqual(unifiedDiff('a\n', 'a\n\nb\n').lines, ['--- AGENTS.md', '+++ AGENTS.md', '@@ -1,1 +1,3 @@', ' a', '+', '+b']);
  assert.deepEqual(unifiedDiff('same\n', 'same\n'), {lines: [], added: 0, removed: 0});
});
test('the edit script keeps every line of both sides in order', () => {
  const a = 'a\nb\nc\nd\ne\n', b = 'b\nX\nd\ne\nf\n', ops = lineDiff(a, b);
  assert.equal(ops.filter(o => o.type !== '+').map(o => o.text + '\n').join(''), a);
  assert.equal(ops.filter(o => o.type !== '-').map(o => o.text + '\n').join(''), b);
});
test('a new section that ends like its neighbour is shown whole, from after a blank line', () => {
  const before = '### A\n\n- Tag: a.\n- Status: same.\n\n### End\n';
  const after = '### A\n\n- Tag: a.\n- Status: same.\n\n### B\n\n- Tag: b.\n- Status: same.\n\n### End\n';
  assert.deepEqual(unifiedDiff(before, after).lines.slice(3), [' - Tag: a.', ' - Status: same.', ' ', '+### B', '+', '+- Tag: b.', '+- Status: same.', '+', ' ### End']);
  const removed = unifiedDiff(after, before).lines.slice(3);
  assert.deepEqual(removed.filter(l => l.startsWith('-')), ['-### B', '-', '-- Tag: b.', '-- Status: same.', '-']);
});
