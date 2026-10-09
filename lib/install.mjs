import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {exclusionById, normalizeSelection, selectedKinds} from './kinds.mjs';
import {vaultRootOf} from './obsidian.mjs';
import {lintConfig, styleById} from './styles.mjs';

export const begin = '<!-- BEGIN tactical-direction-context -->';
export const end = '<!-- END tactical-direction-context -->';
export const defaultNotesDir = 'Agent Notes';
export const npx = 'npx --yes github:andyqioe/auto-note-taker';
const configMarker = '<!-- auto-note-taker: ';

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

/**
 * What an earlier install chose, so a re-run starts from it: {notesDir, selection, headless}, or null when there is
 * no block. Only `update` carries `headless` forward; a full install asks for it on every run.
 * Blocks from before note kinds existed recorded tactical direction only, straight into the notes folder; reading
 * them that way keeps an upgrade from moving anyone's existing notes or recording things they never asked for.
 */
export function installedConfig(prior) {
  const start = prior.indexOf(begin), stop = prior.indexOf(end);
  if (start < 0 || stop < start) return null;
  const block = prior.slice(start, stop);
  const at = block.indexOf(configMarker);
  if (at >= 0) {
    try {
      const raw = JSON.parse(block.slice(at + configMarker.length, block.indexOf(' -->', at)));
      return {notesDir: raw.notesDir ?? null, selection: normalizeSelection(raw), headless: raw.headless === true};
    } catch { /* an edited or damaged config line: fall through to what the text still says */ }
  }
  const legacy = block.match(/tactical direction in `([^`\n]+)` at project scope/)?.[1] ?? block.match(/as notes in `([^`\n]+)` at project scope/)?.[1] ?? null;
  return {notesDir: legacy, selection: normalizeSelection({record: ['tactical-direction'], skip: [], folders: {'tactical-direction': '.'}}), headless: false};
}
export const installedNotesDir = prior => installedConfig(prior)?.notesDir ?? null;

const template = name => fs.readFile(fileURLToPath(new URL(`../context/${name}`, import.meta.url)), 'utf8');
const fill = (text, values) => text.replace(/{{(\w+)}}/g, (whole, key) => key in values ? values[key] : whole);
const sentence = s => s[0].toUpperCase() + s.slice(1).replace(/[.!]?$/, '.');
const customSections = names => names.map((name, i) => `\`## ${i + 1}. ${name}\`` + (/^follow-ups?$/i.test(name) ? ' (open items in a `todo` callout, or "None")' : '')).join(', ');
const detailsLine = details => `How to write these notes, in the user's words (where it differs from the rest of this section or the shared note layout, follow it; it never overrides "Do not record"): ${sentence(details)}`;
/** The Writing rule for the notes' language: the user's own unless the install names one. */
function languageLine(language) {
  if (!language) return '- Write prose in the language the user writes in; keep the required section headings as given.';
  return `- Write note prose in ${language}, whatever language the user writes in; keep the required section headings as given, and keep verbatim quotes in their original language.`;
}

/**
 * The "Writing style" section: the rules of each chosen style, in catalog order, then the user's own. Empty when
 * nothing is chosen, so an install without a style renders the same bytes as one from before styles existed.
 */
async function styleSection({styles: ids, ownStyle, language}) {
  const chosen = ids.map(styleById);
  if (!chosen.length && !ownStyle) return '';
  const english = chosen.filter(s => s.english);
  const lead = [
    '### Writing style',
    '',
    "The user chose how notes read. Apply the rules below to the note's own prose: the title, the banner, the section text, list items and table cells.",
    'Never change verbatim quotes, code, identifiers, file and folder names, property values or the required section headings.',
    ...(chosen.length + (ownStyle ? 1 : 0) > 1 ? ['Where two of these styles disagree, follow the stricter rule.'] : []),
    ...(english.length && language.toLowerCase() !== 'english'
      ? [`The rules of ${english.map(s => s.label).join(' and ')} are for English. When a note is in another language, follow their intent.`] : []),
    ...(lintConfig(ids) ? [`After you write or update a note, run \`${npx} lint "<note path>"\` from the project folder. Fix each warning, or keep the sentence when the rule does not apply.`] : []),
  ];
  const parts = [lead.join('\n')];
  for (const s of chosen) parts.push((await template(`styles/${s.id}.md`)).trimEnd());
  if (ownStyle) parts.push(`#### Your own style\n\nIn the user's words (where it differs from the styles above, follow it; it never changes verbatim quotes or the required section headings): ${sentence(ownStyle)}`);
  return parts.join('\n\n');
}

export const folderPath = (notesDir, folder) => folder === '.' ? notesDir : `${notesDir.replace(/\/+$/, '')}/${folder}`;

/**
 * How links to notes are written: paths from the Obsidian vault holding the notes ('' when the notes folder is the
 * vault), or null when the notes are not in a vault and links are paths from the notes folder.
 */
export function linkPrefixFor(root, notesDir) {
  const notes = resolveNotesDir(root, notesDir), vault = vaultRootOf(notes);
  return vault === null ? null : path.relative(vault, notes).split(path.sep).join('/');
}

/**
 * The managed block for one selection; the same selection always renders the same bytes. Agents ask the user before
 * every note unless the install is headless, which an install has to request explicitly each time it runs.
 */
export async function renderBlock(notesDir, selection, {headless = false, linkPrefix = null} = {}) {
  const chosen = selectedKinds(selection);
  const sections = [];
  for (const k of chosen) {
    const text = await template(k.custom ? 'kinds/custom.md' : `kinds/${k.id}.md`);
    sections.push(fill(text, {folder: folderPath(notesDir, k.folder), tag: k.tag, label: k.label, when: k.when ?? '',
      sections: k.custom ? customSections(k.sections) : '', details_line: k.details ? detailsLine(k.details) : ''}).replace(/\n{2,}(?=- Tag:)/, '\n\n').trimEnd());
  }
  const recordList = chosen.map(k => `- **${k.label}** (\`${folderPath(notesDir, k.folder)}\`): ${sentence(k.custom ? k.when : k.record)}`).join('\n');
  const skipList = [...selection.skip.map(id => `- ${exclusionById(id).rule}`), ...selection.customSkips.map(s => `- ${s}`)].join('\n');
  const askSection = headless ? '' : (await template('ask.md')).trimEnd();
  // The layout example uses a kind this install records, and links the way the notes' vault resolves them.
  const example = [chosen[0].folder === '.' ? '' : chosen[0].folder + '/', 'proxy/session/stateHandling'].join('');
  const linkPath = (linkPrefix ? linkPrefix + '/' : '') + example;
  const body = fill(await template('AGENTS.md'), {notes_dir: notesDir, ask_section: askSection, record_list: recordList, skip_list: skipList,
    kind_sections: sections.join('\n\n'), example_path: example + '.md', language_line: languageLine(selection.language),
    style_section: await styleSection(selection), link_from: linkPrefix === null ? 'from the notes folder' : 'from the vault root',
    link_example: `[[${linkPath}|Session state stays in the controller]]`});
  // One machine-readable line, so the next run can offer exactly this choice again; agents read the prose below it.
  const config = JSON.stringify({notesDir, record: selection.record, skip: selection.skip, customKinds: selection.customKinds,
    customSkips: selection.customSkips, folders: selection.folders, ...(selection.styles.length ? {styles: selection.styles} : {}),
    ...(selection.ownStyle ? {ownStyle: selection.ownStyle} : {}), ...(selection.language ? {language: selection.language} : {}), ...(headless ? {headless} : {})});
  return begin + '\n' + configMarker + config + ' -->\n' + body.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n' + end;
}

export async function planInstall(project, notesDir, selection, {headless = false} = {}) {
  const error = validateNotesDir(notesDir);
  if (error) throw new Error(error);
  if (notesDir.includes('-->')) throw new Error('notes-dir must not contain HTML comment markers');
  const {root, target, prior, exists} = await readProject(project);
  selection = normalizeSelection(selection ?? installedConfig(prior)?.selection);
  const block = await renderBlock(notesDir, selection, {headless, linkPrefix: linkPrefixFor(root, notesDir)});
  const starts = prior.split(begin).length - 1, ends = prior.split(end).length - 1;
  if (starts !== ends || starts > 1 || (starts === 1 && prior.indexOf(end) < prior.indexOf(begin))) throw new Error('Malformed or duplicate managed block; no changes made');
  const next = starts ? prior.slice(0, prior.indexOf(begin)) + block + prior.slice(prior.indexOf(end) + end.length)
    : prior + (prior ? (prior.endsWith('\n\n') ? '' : prior.endsWith('\n') ? '\n' : '\n\n') : '') + block + '\n';
  const change = next === prior ? 'current' : !exists ? 'create' : starts ? 'update' : 'append';
  return {root, target, prior, next, notesDir, selection, headless, change};
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
