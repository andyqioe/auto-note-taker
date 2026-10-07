// Notes live at <kind folder>/<category>/<sub-category>/<detail>.md. Earlier versions kept them flat, named
// <category>-<sub-category>-<detail>.md; this module plans and applies the move to folders, and rewrites every link
// that pointed at a moved note, so the vault keeps working. Planning never touches disk; applying is verified.
import fs from 'node:fs/promises';
import path from 'node:path';
import {writeAtomic} from './install.mjs';

/** A flat note's place in the nested layout: up to two folders from its name, the rest as the file name. */
export function nestedName(file) {
  const name = file.replace(/\.md$/, '');
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(name)) return null;
  const parts = name.split('-'), folders = parts.slice(0, Math.min(2, parts.length - 1));
  return path.join(...folders, parts.slice(folders.length).join('-') + '.md');
}

async function markdownFiles(root, skip = new Set(['.obsidian', '.git', '.trash', 'node_modules'])) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(root, {withFileTypes: true}); } catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && !skip.has(entry.name)) out.push(...await markdownFiles(full, skip));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}
const exists = p => fs.stat(p).then(() => true, () => false);
const noExt = p => p.replace(/\.md$/, '');
const posix = p => p.split(path.sep).join('/');

/**
 * Rewrites the links in one note's text. `moved` maps an old absolute path to its new one; `byName` maps an old
 * note name (and its old path from `linkRoot`) to the moved note, for wikilinks. Relative Markdown links are
 * recomputed from where the note itself now lives.
 */
export function rewriteLinks(text, {oldFile, newFile, moved, byName, linkRoot}) {
  // [[target#heading|alias]] and ![[...]]. A link with no alias gets its old name as one, so the text reads as
  // before; in a table row the pipe is written \| so it does not split the cell.
  const wiki = (line, inTable) => line.replace(/(!?)\[\[([^\]\n|#\\]+)(#[^\]\n|\\]*)?((?:\\?\|)[^\]\n]*)?\]\]/g, (whole, embed, target, heading = '', alias = '') => {
    const key = noExt(target.trim()), to = byName.get(key);
    if (!to) return whole;
    // An alias in a table row needs its pipe escaped too; an unescaped one splits the cell and breaks the table.
    const pipe = inTable ? '\\|' : '|';
    const shown = alias ? (inTable && alias.startsWith('|') ? '\\' + alias : alias) : embed ? '' : pipe + key.split('/').pop();
    return `${embed}[[${posix(noExt(path.relative(linkRoot, to)))}${heading}${shown}]]`;
  });
  text = text.split('\n').map(line => wiki(line, line.trimStart().startsWith('|'))).join('\n');
  // [text](path) and [text](<path with spaces>), with an optional #fragment; web links are left alone.
  return text.replace(/\]\((<[^>\n]+>|[^)\s]+)\)/g, (whole, raw) => {
    const angled = raw.startsWith('<'), url = angled ? raw.slice(1, -1) : raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) return whole;
    const at = url.search(/[#?]/), file = decodeURI(at < 0 ? url : url.slice(0, at)), rest = at < 0 ? '' : url.slice(at);
    if (!file.endsWith('.md')) return whole;
    const target = path.resolve(path.dirname(oldFile), file), newTarget = moved.get(target) ?? target;
    const written = (path.isAbsolute(file) ? newTarget : posix(path.relative(path.dirname(newFile), newTarget))) + rest;
    if (written === file + rest) return whole;
    return `](${angled || /[\s()<>]/.test(written) ? `<${written}>` : written})`;
  });
}

async function allFiles(root) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(root, {withFileTypes: true}); } catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await allFiles(full));
    else out.push(full);
  }
  return out;
}

/** Replaces one tag in a note's `tags: [...]` property, leaving the rest of the note as it was. */
export function retagNote(text, from, to) {
  return text.replace(/^(---\n[\s\S]*?^tags:\s*\[)([^\]\n]*)(\][^\n]*\n[\s\S]*?^---$)/m,
    (whole, head, list, tail) => head + list.split(',').map(t => t.trim() === from ? t.replace(from, to) : t).join(',') + tail);
}

/**
 * The moves that put notes where the layout says, and the edits they need. Each of `folders` is a kind's folder:
 * flat notes directly in `from` move into category folders under `to`, and when a kind was renamed (`from` is not
 * `to`), everything else under `from` moves to the same place under `to`. `retag` replaces a kind's old tag in the
 * notes of its folder. Links are rewritten in every note under `scanRoot` (the whole vault, so links into the notes
 * from elsewhere keep working); `linkRoot` is what wikilink paths start from. Nothing on disk changes.
 */
export async function planNoteMoves({folders, linkRoot, scanRoot, retag = []}) {
  const moves = [], skipped = [], taken = new Set();
  const plan = async (from, to) => {
    if (taken.has(to) || (to !== from && await exists(to))) { skipped.push({path: from, reason: `${path.relative(scanRoot, to)} already exists`}); return; }
    taken.add(to);
    if (to !== from) moves.push({from, to});
  };
  for (const {from: dir, to: target} of folders) {
    for (const file of (await allFiles(dir)).sort()) {
      const relative = path.relative(dir, file), flat = path.dirname(relative) === '.' && nestedName(relative);
      if (!flat && dir === target) continue;
      await plan(file, path.join(target, flat || relative));
    }
  }
  const moved = new Map(moves.map(m => [m.from, m.to]));
  // A wikilink names a note; it can be rewritten only when that name meant exactly one note before the move.
  const all = await markdownFiles(scanRoot);
  const count = new Map();
  for (const f of all) count.set(path.basename(f, '.md'), (count.get(path.basename(f, '.md')) ?? 0) + 1);
  const byName = new Map();
  for (const {from, to} of moves.filter(m => m.from.endsWith('.md'))) {
    if (count.get(path.basename(from, '.md')) === 1) byName.set(path.basename(from, '.md'), to);
    byName.set(posix(noExt(path.relative(linkRoot, from))), to);
  }
  const edits = [];
  for (const file of all) {
    const before = await fs.readFile(file, 'utf8');
    const newFile = moved.get(file) ?? file;
    let after = rewriteLinks(before, {oldFile: file, newFile, moved, byName, linkRoot});
    for (const {dir, from, to} of retag) if (newFile.startsWith(dir + path.sep)) after = retagNote(after, from, to);
    if (after !== before) edits.push({path: newFile, from: file, before, after});
  }
  return {moves, skipped, edits};
}

/** Applies a plan from planNoteMoves, then checks that every note is where the plan put it, with its new text. */
export async function applyNoteMoves({moves, edits}) {
  for (const {from, to} of moves) {
    if (await exists(to)) throw new Error(`${to} appeared during the update; no further notes moved`);
    await fs.mkdir(path.dirname(to), {recursive: true});
    await fs.rename(from, to);
  }
  for (const {path: file, after} of edits) await writeAtomic(file, after);
  for (const {from, to} of moves) if (!(await exists(to)) || await exists(from)) throw new Error(`moving ${from} to ${to} did not complete`);
  for (const {path: file, after} of edits) if (await fs.readFile(file, 'utf8') !== after) throw new Error(`links in ${file} were not rewritten`);
}
