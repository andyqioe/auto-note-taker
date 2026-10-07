// What `update` tidies besides the block: kinds whose name holds instructions, notes still in the flat layout,
// and files earlier installs left behind. Planning reads the disk and changes nothing, so the wizard, a dry run and
// a real run all describe the same operations; applying checks its own work.
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {begin, end, folderPath, installedConfig, linkPrefixFor, renderBlock, resolveNotesDir, writeAtomic} from './install.mjs';
import {folderFor, normalizeSelection, selectedKinds, tagFor} from './kinds.mjs';
import {applyNoteMoves, planNoteMoves} from './layout.mjs';
import {baseName, vaultRootOf} from './obsidian.mjs';
import {summaryMarker, summaryName} from './summary.mjs';

/** Dashboards earlier versions installed, by name, with the hashes of the exact files they shipped. */
const retiredDashboards = {'Tactical Direction.base': [
  '818ab265326f00344448b6f462c7a153d49ff305db18b5d389f9e199e8d9aa63', 'a8eabeba5570f7c6d554fe4ef4ececd17caadb827f1b86cc71f82ff70c4a9f70']};

/**
 * Whether a kind's name reads like its instructions: long, or a name followed by " - " or ": " and more text.
 * Such a name becomes a folder and a tag, so the whole sentence ends up in every path and every note's tags.
 */
export const suspectName = name => name.length > 40 || /\s[-–—:]\s/.test(name) || /\S:\s/.test(name);

/** Splits an instruction-like name into a short name and the rest, which joins the kind's writing instructions. */
export function migrateKind(kind) {
  const match = kind.name.match(/^(.{1,40}?)\s*(?:\s[-–—]|:)\s+(.+)$/);
  const name = (match ? match[1] : kind.name.slice(0, 40)).trim().replace(/[\s,;-]+$/, '');
  const rest = match ? match[2].trim() : kind.name;
  return {...kind, name, details: [rest, kind.details].filter(Boolean).join('; ')};
}

/** The selection with every instruction-like kind name migrated, and the migrations made. */
export function migrateSelection(selection) {
  const migrations = [];
  const customKinds = selection.customKinds.map(k => {
    if (!suspectName(k.name)) return k;
    const to = migrateKind(k);
    migrations.push({from: k, to});
    return to;
  });
  return {selection: normalizeSelection({...selection, customKinds}), migrations};
}

const sha256 = text => createHash('sha256').update(text).digest('hex');
async function filesUnder(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, {withFileTypes: true}); } catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full));
    else out.push(full);
  }
  return out;
}
const exists = p => fs.stat(p).then(() => true, () => false);
/** A summary page the installer still manages: rebuilt, never moved, and no reason to keep a folder. */
export const ownedSummary = async file => path.basename(file) === summaryName && (await fs.readFile(file, 'utf8').catch(() => '')).includes(summaryMarker);
async function notesUnder(dir) {
  const out = [];
  for (const f of await filesUnder(dir)) if (!(await ownedSummary(f))) out.push(f);
  return out;
}

/**
 * Everything the update will do to the notes: moves into the folder layout (and out of renamed kinds' folders),
 * link and tag edits, and removals of what is left over. `before` is the selection the install had, `after` the one
 * it will have, and `migrations` the kinds renamed between them.
 */
export async function planCleanup({root, notesDir, before, after, migrations = []}) {
  const notes = resolveNotesDir(root, notesDir), vault = vaultRootOf(notes);
  const dir = k => path.resolve(notes, k.folder === '.' ? '.' : k.folder);
  const renamed = new Map(migrations.map(m => [folderFor(m.to.name), m]));
  const folders = selectedKinds(after).map(k => {
    const m = renamed.get(k.folder);
    return {from: m ? path.resolve(notes, folderFor(m.from.name)) : dir(k), to: dir(k)};
  });
  // A renamed kind may already have notes in its new folder (moved by hand); those get laid out too.
  for (const m of migrations) folders.push({from: path.resolve(notes, folderFor(m.to.name)), to: path.resolve(notes, folderFor(m.to.name))});
  const retag = migrations.map(m => ({dir: path.resolve(notes, folderFor(m.to.name)), from: tagFor(m.from.name), to: tagFor(m.to.name)}));
  const notesPlan = await planNoteMoves({folders, linkRoot: vault ?? notes, scanRoot: vault ?? notes, retag, owned: ownedSummary});

  const leaving = new Set(notesPlan.moves.map(m => m.from));
  const removals = [];
  // A folder is removed only when nothing but folders and its managed summary will be left in it: a note is never deleted.
  const emptied = async (folder, reason) => {
    if (!(await exists(folder)) || folder === notes || removals.some(r => r.path === folder)) return;
    const files = await notesUnder(folder);
    if (files.every(f => leaving.has(f))) removals.push({path: folder, kind: 'folder', reason});
  };
  for (const m of migrations) await emptied(path.resolve(notes, folderFor(m.from.name)), `old folder of "${m.to.name}"`);
  const kept = new Set(selectedKinds(after).map(dir));
  for (const k of selectedKinds(before)) if (!kept.has(dir(k))) await emptied(dir(k), `empty folder of "${k.label}", no longer recorded`);
  for (const [name, hashes] of Object.entries(retiredDashboards)) {
    const file = path.join(notes, name);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text !== null && hashes.includes(sha256(text))) removals.push({path: file, kind: 'file', reason: `dashboard from an earlier version, replaced by ${baseName}`, text});
  }
  return {notes, vault, ...notesPlan, removals};
}

/** True when there is nothing to tidy. */
export const cleanupEmpty = c => !c.moves.length && !c.edits.length && !c.removals.length;

/** Applies a cleanup plan: notes first (moves, then link and tag edits), then removals; each step is checked. */
export async function applyCleanup(cleanup) {
  await applyNoteMoves(cleanup);
  for (const r of cleanup.removals) {
    if (r.kind === 'file') {
      if (sha256(await fs.readFile(r.path, 'utf8')) !== sha256(r.text)) throw new Error(`${r.path} changed during the update; it was kept`);
      await fs.unlink(r.path);
    } else {
      if ((await notesUnder(r.path)).length) throw new Error(`${r.path} is not empty; it was kept`);
      await fs.rm(r.path, {recursive: true});
    }
    if (await exists(r.path)) throw new Error(`could not remove ${r.path}`);
  }
}

/**
 * Re-reads the instructions file after a write and checks it says what was meant: one block, a settings line that
 * reads back as the chosen settings, and a block that matches what those settings render. On any mismatch the file
 * is put back as it was and the error names what failed.
 */
export async function verifyInstall(plan) {
  const text = await fs.readFile(plan.target, 'utf8');
  const problems = [];
  if (text !== plan.next) problems.push('the file does not hold what was written');
  if (text.split(begin).length !== 2 || text.split(end).length !== 2) problems.push('the file does not have exactly one block');
  const installed = installedConfig(text);
  if (!installed) problems.push('the settings line does not read back');
  else {
    if (installed.notesDir !== plan.notesDir) problems.push(`the notes folder reads back as ${installed.notesDir}`);
    if (JSON.stringify(installed.selection) !== JSON.stringify(normalizeSelection(plan.selection))) problems.push('the kinds or exclusions read back differently');
    if (installed.headless !== Boolean(plan.headless)) problems.push('the headless setting reads back differently');
    const block = text.slice(text.indexOf(begin), text.indexOf(end) + end.length);
    const rendered = await renderBlock(installed.notesDir, installed.selection, {headless: installed.headless, linkPrefix: linkPrefixFor(plan.root, installed.notesDir)});
    if (block !== rendered) problems.push('the block does not match what its settings render');
    for (const k of selectedKinds(installed.selection))
      if (!block.includes(`- **${k.label}** (\`${folderPath(installed.notesDir, k.folder)}\`)`)) problems.push(`"${k.label}" is missing from the Record list`);
  }
  if (problems.length) {
    await writeAtomic(plan.target, plan.prior);
    throw new Error(`the written ${path.basename(plan.target)} failed verification (${problems.join('; ')}); it was restored`);
  }
}
