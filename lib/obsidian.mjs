// Obsidian awareness: find the user's vaults for the picker, and install the optional styling snippet and
// Bases dashboard that make tactical-direction notes render as designed. Notes stay readable without either.
import fs from 'node:fs/promises';
import {existsSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeAtomic} from './install.mjs';

export const snippetName = 'tactical-direction';
export const baseName = 'Agent Notes.base';
const managedMarker = 'auto-note-taker: managed snippet';
const timeProperties = ['created', 'updated'];
const baseMarker = '# auto-note-taker: managed dashboard. Reinstalling updates this file; delete this line to keep your own edits.';

const yamlString = s => JSON.stringify(s);
/**
 * A Bases dashboard for the kinds being recorded: every note grouped by kind, one view per kind grouped by status,
 * and an "Open" view of everything still waiting on someone. Tags select the notes and name their kind, since a
 * note's folder is now its topic (Decisions/pool/hostMode) and notes from earlier installs have no kind folder.
 */
export function dashboard(chosen) {
  const tags = chosen.map(k => `    - file.hasTag(${yamlString(k.tag)})`);
  const open = [...new Set(chosen.flatMap(k => k.open))];
  const columns = ['      - note.aliases', '      - file.name', '      - note.updated'];
  const sized = ['    columnSize:', '      note.aliases: 520', '      file.name: 280'];
  // kind: if(file.hasTag("decision"), "Decisions & tradeoffs", if(...)), as a single-quoted YAML string.
  const kind = chosen.reduceRight((rest, k) => `if(file.hasTag(${yamlString(k.tag)}), ${yamlString(k.label)}, ${rest})`, '""');
  const lines = [baseMarker, 'filters:', '  or:', ...tags,
    'formulas:', `  kind: '${kind.replaceAll("'", "''")}'`,
    'properties:', '  note.status:', '    displayName: Status', '  note.updated:', '    displayName: Updated',
    '  note.aliases:', '    displayName: Note', '  note.implementation:', '    displayName: Implementation', '  formula.kind:', '    displayName: Kind',
    'views:',
    '  - type: table', '    name: All by kind', '    groupBy:', '      property: formula.kind', '      direction: ASC',
    '    order:', ...columns, '      - note.status', '    sort:', '      - property: note.updated', '        direction: DESC', ...sized];
  for (const k of chosen) lines.push('  - type: table', `    name: ${yamlString(k.label)}`, '    filters:', '      and:', `        - file.hasTag(${yamlString(k.tag)})`,
    '    groupBy:', '      property: note.status', '      direction: ASC', '    order:', ...columns, '      - note.implementation',
    '    sort:', '      - property: note.updated', '        direction: DESC', ...sized);
  if (open.length) lines.push('  - type: table', '    name: Open', '    filters:', '      or:', ...open.map(st => `        - 'note.status == ${yamlString(st)}'`),
    '    order:', ...columns, '      - note.status', ...sized);
  return lines.join('\n') + '\n';
}
const asset = name => fileURLToPath(new URL(`../context/obsidian/${name}`, import.meta.url));

/** Obsidian's own vault registry, per platform (including Flatpak and Snap installs on Linux). */
export function registryPaths(home = os.homedir(), platform = process.platform, env = process.env) {
  if (platform === 'darwin') return [path.join(home, 'Library/Application Support/obsidian/obsidian.json')];
  if (platform === 'win32') return [path.join(env.APPDATA || path.join(home, 'AppData/Roaming'), 'obsidian/obsidian.json')];
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [path.join(config, 'obsidian/obsidian.json'),
    path.join(home, '.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json'),
    path.join(home, 'snap/obsidian/current/.config/obsidian/obsidian.json')];
}

/** Vaults Obsidian knows about that still exist on disk, most recently opened first. */
export async function knownVaults(paths = registryPaths()) {
  const vaults = new Map();
  for (const file of paths) {
    let registry;
    try { registry = JSON.parse(await fs.readFile(file, 'utf8')); } catch { continue; }
    for (const v of Object.values(registry.vaults ?? {})) {
      if (typeof v?.path !== 'string' || vaults.has(v.path) || !isDirectory(v.path)) continue;
      vaults.set(v.path, {path: v.path, name: path.basename(v.path), ts: v.ts ?? 0});
    }
  }
  return [...vaults.values()].sort((a, b) => b.ts - a.ts);
}

const isDirectory = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
/** The vault containing `dir`, found by walking up to a folder with `.obsidian/`. `dir` need not exist yet. */
export function vaultRootOf(dir) {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    if (isDirectory(path.join(at, '.obsidian'))) return at;
    if (path.dirname(at) === at) return null;
  }
}

/**
 * Plans the vault extras without touching disk. Each step says what would happen and why, so the wizard can
 * show it before asking and --check style callers can report it. User-edited files are never overwritten.
 */
export async function planExtras(vault, notesAbsolute, chosen) {
  const snippet = await fs.readFile(asset(`${snippetName}.css`), 'utf8');
  const base = dashboard(chosen);
  const steps = [];
  const snippetPath = path.join(vault, '.obsidian/snippets', `${snippetName}.css`);
  const existing = await fs.readFile(snippetPath, 'utf8').catch(() => null);
  steps.push({path: snippetPath, text: snippet, label: 'note styling snippet',
    action: existing === null ? 'create' : existing === snippet ? 'current' : existing.includes(managedMarker) ? 'update' : 'keep (edited by you)'});
  const appearancePath = path.join(vault, '.obsidian/appearance.json');
  let appearance = {}, readable = true;
  try { appearance = JSON.parse(await fs.readFile(appearancePath, 'utf8')); } catch (e) { readable = e.code === 'ENOENT'; }
  const enabled = Array.isArray(appearance.enabledCssSnippets) ? appearance.enabledCssSnippets : [];
  steps.push({path: appearancePath, label: 'enable the snippet',
    text: JSON.stringify({...appearance, enabledCssSnippets: [...enabled, snippetName]}, null, 2),
    action: !readable ? 'keep (unreadable JSON)' : enabled.includes(snippetName) ? 'current' : 'update'});
  const basePath = path.join(notesAbsolute, baseName);
  const existingBase = await fs.readFile(basePath, 'utf8').catch(() => null);
  steps.push({path: basePath, text: base, label: 'notes dashboard (Bases)',
    action: existingBase === null ? 'create' : existingBase === base ? 'current' : existingBase.startsWith(baseMarker) ? 'update' : 'keep (edited by you)'});
  // Obsidian guesses a property's type from its first value and reads a time with seconds as text, so the
  // timestamps are typed explicitly; other properties keep whatever type the vault already gave them.
  const typesPath = path.join(vault, '.obsidian/types.json');
  let types = {}, typesExist = true;
  readable = true;
  try { types = JSON.parse(await fs.readFile(typesPath, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') typesExist = false; else readable = false; }
  const assigned = types.types && typeof types.types === 'object' ? types.types : {};
  const stale = timeProperties.filter(name => assigned[name] !== 'datetime');
  steps.push({path: typesPath, label: 'date-and-time properties',
    text: JSON.stringify({...types, types: {...assigned, ...Object.fromEntries(timeProperties.map(name => [name, 'datetime']))}}, null, 2),
    action: !readable ? 'keep (unreadable JSON)' : !typesExist ? 'create' : stale.length ? 'update' : 'current'});
  return steps;
}

export async function writeExtras(steps) {
  for (const step of steps) {
    if (step.action !== 'create' && step.action !== 'update') continue;
    await fs.mkdir(path.dirname(step.path), {recursive: true});
    if (step.action === 'create') await fs.writeFile(step.path, step.text, {flag: 'wx'});
    else await writeAtomic(step.path, step.text);
  }
}
