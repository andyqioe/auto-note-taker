// Obsidian awareness: find the user's vaults for the picker, and install the optional styling snippet and
// Bases dashboard that make tactical-direction notes render as designed. Notes stay readable without either.
import fs from 'node:fs/promises';
import {existsSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeAtomic} from './install.mjs';

export const snippetName = 'tactical-direction';
export const baseName = 'Tactical Direction.base';
const managedMarker = 'auto-note-taker: managed snippet';
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
export async function planExtras(vault, notesAbsolute) {
  const snippet = await fs.readFile(asset(`${snippetName}.css`), 'utf8');
  const base = await fs.readFile(asset(baseName), 'utf8');
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
  steps.push({path: basePath, text: base, label: 'decisions dashboard (Bases)', action: existsSync(basePath) ? 'current' : 'create'});
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
