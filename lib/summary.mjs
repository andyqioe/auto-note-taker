// Every kind's folder has a summary.md: each note of that kind, by category, with its status and last update.
// It is built from the notes' own properties, so the same notes always give the same page, and a rebuild never
// loses anything an agent wrote in a note. Agents add their row when they write a note; update rebuilds it.
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveNotesDir, writeAtomic} from './install.mjs';
import {selectedKinds} from './kinds.mjs';
import {vaultRootOf} from './obsidian.mjs';

export const summaryName = 'summary.md';
export const summaryMarker = '<!-- auto-note-taker: managed summary. update rebuilds this page from the notes\' properties; delete this line to keep your own edits. -->';

/** The few properties a summary row needs, read from a note's frontmatter, with the first heading as a fallback title. */
export function noteFacts(text) {
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const prop = name => front.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'))?.[1].trim() ?? '';
  const alias = prop('aliases').match(/^\[\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? prop('aliases').match(/^\[\s*([^,\]]+)/)?.[1]?.trim();
  const heading = text.slice(front ? text.indexOf('\n---', 3) + 4 : 0).match(/^# (.+)$/m)?.[1];
  const tags = prop('tags').replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean);
  return {title: (alias || heading || '').trim(), status: prop('status'), updated: prop('updated').replace('T', ' '), tags};
}

/** Every note under `dir`, skipping hidden folders and the summary pages the installer writes. */
export async function notesIn(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, {withFileTypes: true}); } catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) out.push(...await notesIn(full));
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== summaryName) out.push(full);
  }
  return out;
}

const cell = s => String(s).replaceAll('|', '\\|').replace(/\n/g, ' ');
const posix = p => p.split(path.sep).join('/');

/**
 * The summary page for one kind. `notes` are {file, text}; `linkRoot` is what link paths start from (the vault, else
 * the notes folder). Categories are listed alphabetically, and each category's notes newest first.
 */
export function renderSummary(kind, notes, {kindDir, linkRoot}) {
  const rows = notes.map(({file, text}) => {
    const facts = noteFacts(text), parts = posix(path.relative(kindDir, file)).split('/');
    return {...facts, title: facts.title || path.basename(file, '.md'), link: posix(path.relative(linkRoot, file)).replace(/\.md$/, ''),
      category: parts.length > 1 ? parts[0] : 'other', sub: parts.length > 2 ? parts.slice(1, -1).join('/') : '-'};
  });
  const open = rows.filter(r => kind.open.includes(r.status)).length;
  const newest = rows.map(r => r.updated).filter(Boolean).sort().at(-1);
  const count = `${rows.length} ${rows.length === 1 ? 'note' : 'notes'}`;
  const lines = ['---', `aliases: ["${kind.label} summary"]`, 'cssclasses: [agent-note]', '---', summaryMarker, '', `# ${kind.label} summary`, '',
    `> [!info|banner] ${kind.open.length ? `${count}, ${open} open` : count}${newest ? `, last updated ${newest}` : ''}`,
    `> Every ${kind.label} note, by category. Open a note for its detail.`];
  if (!rows.length) lines.push('', 'No notes yet.');
  for (const category of [...new Set(rows.map(r => r.category))].sort((a, b) => a.localeCompare(b))) {
    lines.push('', `## ${category}`, '', '| Note | Sub-category | Status | Updated |', '| --- | --- | --- | --- |');
    const mine = rows.filter(r => r.category === category)
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
    for (const r of mine) lines.push(`| [[${r.link}\\|${cell(r.title)}]] | ${cell(r.sub)} | ${cell(r.status || '-')} | ${cell(r.updated || '-')} |`);
  }
  return lines.join('\n') + '\n';
}

/**
 * The summary page each recorded kind should have, and what writing it would do: create it, update a managed one,
 * leave a current one, or keep one the user has made their own (its marker line removed). Nothing is planned while
 * the notes folder does not exist yet.
 */
export async function planSummaries({root, notesDir, selection}) {
  const notes = resolveNotesDir(root, notesDir), linkRoot = vaultRootOf(notes) ?? notes;
  const steps = [];
  // The notes folder is the agents' to create, with their first note; until it exists there is nothing to sum up.
  if (!(await fs.stat(notes).then(s => s.isDirectory(), () => false))) return steps;
  for (const kind of selectedKinds(selection)) {
    const kindDir = path.resolve(notes, kind.folder);
    let files = await notesIn(kindDir);
    // A kind kept straight in the notes folder (installs from before kinds) shares it with the others: use its tag.
    const texts = await Promise.all(files.map(f => fs.readFile(f, 'utf8')));
    let pairs = files.map((file, i) => ({file, text: texts[i]}));
    if (kind.folder === '.') pairs = pairs.filter(n => noteFacts(n.text).tags.includes(kind.tag));
    const file = path.join(kindDir, summaryName), text = renderSummary(kind, pairs, {kindDir, linkRoot});
    const existing = await fs.readFile(file, 'utf8').catch(() => null);
    steps.push({kind, path: file, text, action: existing === null ? 'create' : existing === text ? 'current' : existing.includes(summaryMarker) ? 'update' : 'keep (edited by you)'});
  }
  return steps;
}

/** Writes the summaries that need it, then reads each back. */
export async function writeSummaries(steps) {
  for (const step of steps.filter(s => s.action === 'create' || s.action === 'update')) {
    await fs.mkdir(path.dirname(step.path), {recursive: true});
    if (step.action === 'create') await fs.writeFile(step.path, step.text, {flag: 'wx'});
    else await writeAtomic(step.path, step.text);
    if (await fs.readFile(step.path, 'utf8') !== step.text) throw new Error(`${step.path} did not read back as written`);
  }
}
