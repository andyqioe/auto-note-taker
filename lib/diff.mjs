// A dependency-free line diff, so every run can show exactly what it changes in the instructions file.
import {c} from './ui.mjs';

/** A file's lines: a final newline ends the last line rather than starting an empty one. */
const toLines = text => text === '' ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');

/**
 * The edit script from `before` to `after`, one entry per line: ' ' kept, '-' removed, '+' added. The unchanged
 * head and tail are matched first, so a change confined to the managed block costs only the block's size.
 */
export function lineDiff(before, after) {
  const a = toLines(before), b = toLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail);
  // Longest common subsequence over the changed middle; lcs[i][j] is the length for x[i..] and y[j..].
  const lcs = Array.from({length: x.length + 1}, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops = a.slice(0, head).map(text => ({type: ' ', text}));
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { ops.push({type: ' ', text: x[i]}); i++; j++; }
    // On a tie, removals come first, as in git, so a replaced line reads old then new.
    else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push({type: '-', text: x[i++]});
    else ops.push({type: '+', text: y[j++]});
  }
  ops.push(...a.slice(a.length - tail).map(text => ({type: ' ', text})));
  return slide(ops);
}

/**
 * Moves each block of added (or removed) lines to where it reads best. When a block's last line equals the line
 * above it, or its first line the line below, the same change can be shown one line higher or lower; a new
 * section that ends like its neighbour would otherwise be split around an old line. Like git's heuristic, this
 * prefers a block that starts after a blank line and ends with one, so whole sections stay together.
 */
function slide(ops) {
  const blank = op => !op || op.text.trim() === '';
  for (let start = 0; start < ops.length; start++) {
    const type = ops[start].type;
    if (type === ' ') continue;
    let n = 1;
    while (start + n < ops.length && ops[start + n].type === type) n++;
    // Shifting the block at `at` by one line swaps which copy of a repeated line is the change.
    const up = at => { ops[at - 1] = {type, text: ops[at - 1].text}; ops[at + n - 1] = {type: ' ', text: ops[at + n - 1].text}; };
    const down = at => { ops[at + n] = {type, text: ops[at + n].text}; ops[at] = {type: ' ', text: ops[at].text}; };
    const canUp = at => at > 0 && ops[at - 1].type === ' ' && ops[at - 1].text === ops[at + n - 1].text;
    const canDown = at => at + n < ops.length && ops[at + n].type === ' ' && ops[at + n].text === ops[at].text;
    let at = start;
    while (canUp(at)) up(at--);
    let best = at, bestScore = -1;
    for (;;) {
      const score = 2 * blank(ops[at - 1]) + blank(ops[at + n - 1]);
      if (score > bestScore) { best = at; bestScore = score; }
      if (!canDown(at)) break;
      down(at++);
    }
    while (at > best) up(at--);
    start = best + n - 1;
  }
  return ops;
}

/** A unified diff (`--- name`, `+++ name`, `@@` hunks with `context` lines around each change) and its line counts. */
export function unifiedDiff(before, after, {name = 'AGENTS.md', context = 3} = {}) {
  const ops = lineDiff(before, after);
  const added = ops.filter(o => o.type === '+').length, removed = ops.filter(o => o.type === '-').length;
  if (!added && !removed) return {lines: [], added, removed};
  const lines = [`--- ${before ? name : '/dev/null'}`, `+++ ${name}`];
  // Line numbers on each side before every op, so a hunk header can say where it starts.
  const at = [];
  for (let k = 0, oldLine = 1, newLine = 1; k < ops.length; k++) {
    at.push([oldLine, newLine]);
    if (ops[k].type !== '+') oldLine++;
    if (ops[k].type !== '-') newLine++;
  }
  const changed = ops.map((o, k) => o.type !== ' ' ? k : -1).filter(k => k >= 0);
  for (let n = 0; n < changed.length;) {
    let start = Math.max(0, changed[n] - context), end = Math.min(ops.length, changed[n] + context + 1);
    // Changes closer together than twice the context share one hunk.
    while (++n < changed.length && changed[n] - context <= end) end = Math.min(ops.length, changed[n] + context + 1);
    const hunk = ops.slice(start, end);
    const oldCount = hunk.filter(o => o.type !== '+').length, newCount = hunk.filter(o => o.type !== '-').length;
    const [oldStart, newStart] = at[start];
    lines.push(`@@ -${oldCount ? oldStart : oldStart - 1},${oldCount} +${newCount ? newStart : newStart - 1},${newCount} @@`);
    lines.push(...hunk.map(o => o.type + o.text));
  }
  return {lines, added, removed};
}

/** The color of a unified diff line, as git uses them: additions green, removals red, file headers bold, hunks accented. */
export const diffStyle = line => line.startsWith('+++') || line.startsWith('---') ? c.bold
  : line.startsWith('+') ? c.green : line.startsWith('-') ? c.red : line.startsWith('@@') ? c.accent : s => s;
export const colorDiffLine = line => diffStyle(line)(line);

/** "+12 −3 lines", the size of a change at a glance; a side with nothing to count is left out. */
export const diffStat = ({added, removed}) => [added ? c.green('+' + added) : '', removed ? c.red('−' + removed) : '',
  added + removed === 1 ? 'line' : 'lines'].filter(Boolean).join(' ');
