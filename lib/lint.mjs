// `lint`: checks notes against the writing styles an install chose, or the ones named with --style, using the
// rules a script can check (lib/ste.mjs). It reports, it never edits: a warning is a question for the writer.

import fs from 'node:fs/promises';
import path from 'node:path';
import {installedConfig, readProject, resolveNotesDir} from './install.mjs';
import {check, reportLines} from './ste.mjs';
import {lintConfig, styleById} from './styles.mjs';
import {notesIn} from './summary.mjs';

/**
 * What to check and how: the styles (from --style, else the install), their combined configuration, and the files
 * (the ones named, else every note in the install's notes folder). Throws when there is nothing to check against.
 */
export async function planLint({project, style, files = []}) {
  const {root, prior} = await readProject(project);
  const installed = installedConfig(prior);
  const styles = style ?? installed?.selection.styles ?? [];
  const unknown = styles.filter(id => !styleById(id));
  if (unknown.length) throw new Error(`unknown style ${unknown.join(', ')}`);
  const config = lintConfig(styles);
  if (!config) throw new Error(styles.length ? `${styles.map(id => styleById(id).label).join(' and ')} has no rule a script can check`
    : 'no writing style to check against; install one, or pass --style');
  if (!files.length && !installed?.notesDir) throw new Error('no notes folder is installed here; name the notes to check');
  const paths = files.length ? files.map(f => path.resolve(f)) : (await notesIn(resolveNotesDir(root, installed.notesDir))).sort();
  return {root, styles, config, paths};
}

/** One report per file: {file, sentences, warnings}. */
export async function runLint({config, paths}) {
  const reports = [];
  for (const file of paths) reports.push({file, ...check(await fs.readFile(file, 'utf8'), config)});
  return reports;
}

/** The text report: each file with warnings, then one total line. Files are shown from the project when inside it. */
export function lintLines(reports, {root, styles, limit = 20}) {
  const label = f => { const r = path.relative(root, f); return r && !r.startsWith('..') ? r.split(path.sep).join('/') : f; };
  const total = reports.reduce((n, r) => n + r.warnings.length, 0);
  const lines = reports.filter(r => r.warnings.length).flatMap(r => reportLines(r, label(r.file), limit));
  const names = styles.map(id => styleById(id).label).join(', ');
  lines.push(`${total} warning${total === 1 ? '' : 's'} in ${reports.length} note${reports.length === 1 ? '' : 's'} (${names}). A warning is a question: fix the sentence, or keep it when the rule does not apply.`);
  return lines;
}
