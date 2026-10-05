import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const begin = '<!-- BEGIN tactical-direction-context -->';
export const end = '<!-- END tactical-direction-context -->';
export const defaultNotesDir = 'Tactical Direction';

export const expandHome = p => p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
export function validateNotesDir(value) {
  if (!value.trim()) return 'notes-dir must be nonempty';
  if (/[\r\n`]/.test(value)) return 'notes-dir must be a single-line path without backticks';
  return '';
}
/** Notes inside the project are written project-relative, so the instructions survive moving or cloning it. */
export function notesDirFor(root, absolute) {
  const relative = path.relative(root, absolute);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : absolute;
}
export const resolveNotesDir = (root, notesDir) => path.resolve(root, expandHome(notesDir));

/** Reads the project's instructions file without writing anything; refuses symlinks that leave the project. */
export async function readProject(project) {
  const root = await fs.realpath(path.resolve(expandHome(project)));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('project must be an existing directory');
  const agents = path.join(root, 'AGENTS.md');
  // Preserve a project's AGENTS.md -> CLAUDE.md convention. Refuse external targets.
  let target = agents, prior = '', exists = false;
  try {
    target = await fs.realpath(agents);
    const relative = path.relative(root, target);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('AGENTS.md points outside the project; install in its owning project instead');
    if (!(await fs.stat(target)).isFile()) throw new Error('AGENTS.md must be a regular file or internal symlink');
    prior = await fs.readFile(target, 'utf8');
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A dangling symlink is not a missing instructions file.
    try { await fs.lstat(agents); throw new Error('AGENTS.md is a dangling symlink'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return {root, target, prior, exists};
}

/** The notes directory recorded by an earlier install, so a re-run can offer to keep it. */
export function installedNotesDir(prior) {
  const start = prior.indexOf(begin), stop = prior.indexOf(end);
  if (start < 0 || stop < start) return null;
  return prior.slice(start, stop).match(/tactical direction in `([^`\n]+)` at project scope/)?.[1] ?? null;
}

export async function planInstall(project, notesDir) {
  const error = validateNotesDir(notesDir);
  if (error) throw new Error(error);
  const {root, target, prior, exists} = await readProject(project);
  const template = await fs.readFile(fileURLToPath(new URL('../context/AGENTS.md', import.meta.url)), 'utf8');
  const block = begin + '\n' + template.replaceAll('{{notes_dir}}', () => notesDir).trimEnd() + '\n' + end;
  const starts = prior.split(begin).length - 1, ends = prior.split(end).length - 1;
  if (starts !== ends || starts > 1 || (starts === 1 && prior.indexOf(end) < prior.indexOf(begin))) throw new Error('Malformed or duplicate managed block; no changes made');
  const next = starts ? prior.slice(0, prior.indexOf(begin)) + block + prior.slice(prior.indexOf(end) + end.length)
    : prior + (prior ? (prior.endsWith('\n\n') ? '' : prior.endsWith('\n') ? '\n' : '\n\n') : '') + block + '\n';
  const change = next === prior ? 'current' : !exists ? 'create' : starts ? 'update' : 'append';
  return {root, target, prior, next, notesDir, change};
}

export async function writeInstall({target, prior, next}) {
  if (next === prior) return false;
  // Do not overwrite an edit that landed while the installer was reading its template.
  const current = await fs.readFile(target, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
  if (current !== prior) throw new Error('Project instructions changed during installation; retry');
  await writeAtomic(target, next);
  return true;
}

export async function writeAtomic(target, text) {
  const temporary = target + '.tactical-direction-' + process.pid;
  const mode = await fs.stat(target).then(s => s.mode & 0o777).catch(() => 0o644);
  await fs.writeFile(temporary, text, {flag: 'wx', mode});
  try { await fs.rename(temporary, target); }
  finally { await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
