#!/usr/bin/env node
import {existsSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultNotesDir, expandHome, installedConfig, installedNotesDir, notesDirFor, planInstall, readProject, resolveNotesDir, validateNotesDir, writeInstall} from '../lib/install.mjs';
import {defaultCustomSections, defaultRecord, defaultSkip, exclusions, folderFor, kindById, kinds, maxDetails, normalizeSelection, parseSections, selectedKinds, validateSections, validateText} from '../lib/kinds.mjs';
import {baseName, knownVaults, planExtras, vaultRootOf, writeExtras} from '../lib/obsidian.mjs';
import {applyCleanup, cleanupEmpty, migrateSelection, planCleanup, verifyInstall} from '../lib/cleanup.mjs';
import {colorDiffLine, diffStat, diffStyle, unifiedDiff} from '../lib/diff.mjs';
import {planSummaries, summaryName, writeSummaries} from '../lib/summary.mjs';
import {Back, Cancelled, browsePrompt, c, checklistPrompt, confirmPrompt, displayPath, glyph, inputPrompt, listWrap, pagerPrompt, run, selectPrompt, visibleLength} from '../lib/ui.mjs';

const npx = 'npx --yes github:andyqioe/auto-note-taker';
const usage = `Usage: auto-note-taker [--project PATH] [--notes-dir PATH] [--record KINDS] [--skip ITEMS] [--add-kind KIND]...
                       [--add-skip TEXT]... [--obsidian-extras | --no-obsidian-extras] [--headless] [--yes] [--check]
       auto-note-taker update [--project PATH] [--add-kind KIND [--kind-sections LIST] [--kind-details TEXT]]...
                       [--remove-kind KIND]... [--dry-run] [--yes]

Installs or updates one managed block in AGENTS.md telling agents which moments to record as Obsidian notes,
and which to leave out, and prints the diff of what it changed. Run in a terminal with no flags to choose
everything interactively; the confirm screen shows the same diff on d.

  --project PATH          project whose AGENTS.md receives the block (default: current directory)
  --notes-dir PATH        where notes go, one subfolder per kind; relative paths are inside the project
                          (default: the folder chosen last time, else "${defaultNotesDir}")
  --record KINDS          comma-separated kinds to record, or "none" (default: last choice, else ${defaultRecord.join(',')})
                          ${kinds.map(k => k.id).join(', ')}
  --skip ITEMS            comma-separated things never to record, or "none" (default: last choice, else ${defaultSkip.join(',')})
                          ${exclusions.map(e => e.id).join(', ')}
  --add-kind KIND         also record one more kind: a built-in id from the --record list, or one of your own as
                          "NAME=WHEN", for example "Perf wins=a change measurably sped something up"
  --kind-sections LIST    the comma-separated sections of the kind of your own just added
                          (default: ${defaultCustomSections.join(', ')})
  --kind-details TEXT     how agents should write the kind of your own just added, in your words
  --add-skip TEXT         also never record this, in your words
  --obsidian-extras       also install the note styling snippet and a Bases dashboard into the notes' vault
  --no-obsidian-extras    never offer them
  --headless              let agents write notes without asking; by default they ask a Yes/No question before each
                          note. Pass it on every run that should stay headless, --check included
  --yes, -y               do not prompt; use defaults for anything not given
  --check                 report whether the block is current, and print the diff an install would make,
                          without writing

update changes which kinds an existing install records, and keeps its notes folder, exclusions and headless
setting. It also brings an older install up to date: a kind whose name holds its instructions gets a short name,
flat notes move into <kind>/<category>/<sub-category>/ folders with every link to them rewritten, and files and
empty folders earlier versions left behind are removed (never a note). In a terminal with no kinds named, it asks
which to add or remove. Everything it writes is read back and checked.

  --add-kind KIND         as above; giving a kind of your own a name it already has replaces its definition
  --remove-kind KIND      stop recording a kind, by id or name; its notes stay where they are
  --dry-run               print everything update would change, and change nothing`;

const args = process.argv.slice(2);
const updating = args[0] === 'update';
if (updating) args.shift();
const options = {addKind: [], addRecord: [], removeKind: [], addSkip: []};
let check = false, yes = false, headless = false, dryRun = false, extras;
const list = v => v === 'none' ? [] : v.split(',').map(x => x.trim()).filter(Boolean);
const valueFlags = ['--project', '--notes-dir', '--record', '--skip', '--add-kind', '--kind-sections', '--kind-details', '--add-skip', '--remove-kind'];
// update edits the kinds of an install and nothing else, so flags that would change the rest of it are refused.
const updateFlags = ['--project', '--add-kind', '--kind-sections', '--kind-details', '--remove-kind', '--dry-run', '--yes', '-y', '--help', '-h'];
function parse() {
  let ownKind = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (updating && !updateFlags.includes(arg) && arg.startsWith('-'))
      throw new Error(`update only adds or removes kinds; run the installer without "update" to use ${arg}`);
    if (arg === '--help' || arg === '-h') { console.log(usage); process.exit(0); }
    if (arg === '--check') { check = true; continue; }
    if (arg === '--dry-run' && updating) { dryRun = true; continue; }
    if (arg === '--yes' || arg === '-y') { yes = true; continue; }
    if (arg === '--headless') { headless = true; continue; }
    if (arg === '--obsidian-extras' || arg === '--no-obsidian-extras') { extras = arg === '--obsidian-extras'; continue; }
    if (!valueFlags.includes(arg) || args[i + 1] === undefined || args[i + 1].startsWith('--') || (arg === '--remove-kind' && !updating))
      throw new Error(`Invalid argument: ${arg}`);
    const value = args[++i];
    if (arg === '--record' || arg === '--skip') options[arg.slice(2)] = list(value);
    else if (arg === '--add-kind') {
      const at = value.indexOf('=');
      ownKind = null;
      if (at < 0 && kindById(value.trim())) options.addRecord.push(value.trim());
      else if (at < 1) throw new Error(`--add-kind takes a built-in kind (${kinds.map(k => k.id).join(', ')}) or one of your own as "NAME=WHEN", for example "Perf wins=a change measurably sped something up"`);
      else options.addKind.push(ownKind = {name: value.slice(0, at).trim(), when: value.slice(at + 1).trim()});
    } else if (arg === '--kind-sections' || arg === '--kind-details') {
      const field = arg === '--kind-sections' ? 'sections' : 'details';
      if (!ownKind) throw new Error(`${arg} describes a kind of your own, so it must follow --add-kind "NAME=WHEN"`);
      if (field in ownKind) throw new Error(`${arg} is given twice for "${ownKind.name}"`);
      ownKind[field] = field === 'sections' ? parseSections(value) : value;
    } else if (arg === '--remove-kind') options.removeKind.push(value.trim());
    else if (arg === '--add-skip') options.addSkip.push(value);
    else options[arg.slice(2)] = value;
  }
}
const lower = s => s.trim().toLowerCase();
/** Whether `ref` (an id, a label or a name, any case) names this kind. */
const names = (k, ref) => [k.id, k.label].some(n => lower(n) === lower(ref));

/**
 * The selection flags ask for, on top of what the project chose last time: --record and --skip replace a list
 * (and the custom kinds or rules that went with it), --add-kind and --add-skip extend it, and a kind of your own
 * added under a name the project already has replaces that kind's definition.
 */
function selectionFrom(prior) {
  const base = prior ?? {record: defaultRecord, skip: defaultSkip, customKinds: [], customSkips: [], folders: {}};
  const current = selectedKinds(normalizeSelection(base));
  for (const ref of options.removeKind) if (!current.some(k => names(k, ref)))
    throw new Error(`"${ref}" is not recorded here; recorded kinds: ${current.map(k => k.custom ? k.label : k.id).join(', ')}`);
  const removed = k => options.removeKind.some(ref => names(k, ref));
  const added = new Set(options.addKind.map(k => lower(k.name)));
  return normalizeSelection({
    record: [...(options.record ?? base.record), ...options.addRecord].filter(id => !removed({id, label: kindById(id)?.label ?? id})),
    folders: base.folders,
    customKinds: [...(options.record ? [] : base.customKinds).filter(k => !added.has(lower(k.name)) && !removed({id: '', label: k.name})), ...options.addKind],
    skip: options.skip ?? base.skip, customSkips: [...(options.skip ? [] : base.customSkips), ...options.addSkip],
    styles: base.styles, ownStyle: base.ownStyle, language: base.language,
  });
}
function labels(selection) { return selectedKinds(selection).map(k => k.label).join(', '); }

// Paths under home print as "$HOME/…" so a printed command stays short and still works when pasted into a shell.
function quote(s) {
  const home = os.homedir();
  if (s.startsWith(home + path.sep)) return `"$HOME/${s.slice(home.length + 1).replace(/["\\$`]/g, '\\$&')}"`;
  return /^[\w./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
}
/** The flags that recreate one kind: its id for a built-in, otherwise its definition. */
const kindFlags = k => !k.custom ? [`--add-kind ${k.id}`] : [`--add-kind ${quote(`${k.label}=${k.when}`)}`,
  ...(k.sections !== defaultCustomSections ? [`--kind-sections ${quote(k.sections.join(', '))}`] : []),
  ...(k.details ? [`--kind-details ${quote(k.details)}`] : [])];
/** One flag per line, joined with backslashes, so long paths never wrap mid-word and the block still pastes as one command. */
const printCommand = (out, title, parts) => {
  out(c.dim(`   ${title}`));
  out(c.dim(parts.map((part, i) => `   ${i ? '  ' : ''}${part}`).join(' \\\n')));
};

/** What a plan changes in the instructions file, as a unified diff named after the file agents read. */
const changesOf = plan => unifiedDiff(plan.prior, plan.next, {name: path.relative(plan.root, plan.target) || 'AGENTS.md'});
/** Prints a plan's diff after a blank line; colored only on a terminal, so logs and pipes get plain text. */
function printDiff(plan) {
  const {lines} = changesOf(plan);
  if (!lines.length) return;
  console.log('\n' + lines.map(l => process.stdout.isTTY ? colorDiffLine(l) : l).join('\n'));
}
/** The confirm row that sizes the change, for example "changes  AGENTS.md  +12 −3 lines". */
function changesRow(plan, key) {
  const diff = changesOf(plan), name = path.relative(plan.root, plan.target) || 'AGENTS.md';
  return `${c.dim(key)}  ${diff.lines.length ? `${name}  ${diffStat(diff)}` : c.dim('none')}`;
}
/**
 * Asks `prompt` until it is answered Yes or No; `d` opens the plan's diff in a scrolling view and comes back here,
 * so the change can be read in full before anything is written.
 */
async function confirmWithReview(plan, prompt, extra = []) {
  const lines = [...changesOf(plan).lines, ...(extra.length ? ['', ...extra] : [])];
  const rows = Math.max(5, Math.min(30, (process.stdout.rows || 24) - 4));
  const title = extra.length ? 'Changes' : `Changes to ${path.relative(plan.root, plan.target) || 'AGENTS.md'}`;
  for (;;) {
    const answer = await run(confirmPrompt({...prompt, review: lines.some(Boolean) ? 'show changes' : ''}));
    if (answer !== 'review') return answer;
    await run(pagerPrompt({title, lines: lines.length && !lines[0] ? lines.slice(1) : lines, style: diffStyle, rows}));
  }
}

/** Builds every kind's summary.md from its notes and writes the ones that changed; returns what it did. */
async function refreshSummaries(plan) {
  const steps = await planSummaries({root: plan.root, notesDir: plan.notesDir, selection: plan.selection});
  await writeSummaries(steps);
  return steps.filter(s => s.action !== 'current');
}
const summaryLine = (plan, s) => `${s.action === 'create' ? 'Created' : s.action === 'update' ? 'Updated' : 'Kept (edited by you)'} summary: ${path.relative(resolveNotesDir(plan.root, plan.notesDir), s.path).split(path.sep).join('/')}`;

async function direct() {
  const {prior} = await readProject(options.project ?? process.cwd());
  const installed = installedConfig(prior);
  const plan = await planInstall(options.project ?? process.cwd(), options['notes-dir'] ?? installed?.notesDir ?? defaultNotesDir, selectionFrom(installed?.selection), {headless});
  if (check) {
    console.log(plan.change === 'current' ? 'Context is current.' : 'Context is missing or out of date.');
    printDiff(plan);
    process.exitCode = plan.change === 'current' ? 0 : 1;
    return;
  }
  if (await writeInstall(plan)) {
    await verifyInstall(plan);
    console.log(`Installed: ${plan.target}\nNotes: ${plan.notesDir}\nRecording: ${labels(plan.selection)}\nAsk before each note: ${headless ? 'no (headless)' : 'yes'}`);
    for (const s of await refreshSummaries(plan)) console.log(summaryLine(plan, s));
    printDiff(plan);
  } else {
    console.log(`Already installed: ${plan.target}`);
    for (const s of await refreshSummaries(plan)) console.log(summaryLine(plan, s));
  }
  if (extras) {
    const notesAbsolute = resolveNotesDir(plan.root, plan.notesDir), vault = vaultRootOf(notesAbsolute);
    if (!vault) console.log('Obsidian extras skipped: the notes folder is not inside an Obsidian vault.');
    else { const steps = await planExtras(vault, notesAbsolute, selectedKinds(plan.selection)); await writeExtras(steps); steps.forEach(s => console.log(`Obsidian ${s.label}: ${s.action} ${s.path}`)); }
  }
}

// ---- update -------------------------------------------------------------------------------------------------

/** The install `update` starts from; it never creates one, since it has no notes folder or exclusions to keep. */
async function installedFor(project) {
  const {prior, target} = await readProject(project);
  const installed = installedConfig(prior);
  if (!installed) throw new Error(`${target} has no auto-note-taker block to update; install first with: ${npx}`);
  return {...installed, notesDir: installed.notesDir ?? defaultNotesDir};
}

/** What an update adds, removes and redefines, compared kind by kind. */
function kindChanges(before, after) {
  const key = k => lower(k.label), was = new Map(selectedKinds(before).map(k => [key(k), k]));
  const now = selectedKinds(after), kept = new Set(now.map(key));
  const same = (a, b) => a.when === b.when && a.details === b.details && a.sections.join('\n') === b.sections.join('\n');
  return {
    added: now.filter(k => !was.has(key(k))),
    changed: now.filter(k => k.custom && was.has(key(k)) && !same(k, was.get(key(k)))),
    removed: [...was.values()].filter(k => !kept.has(key(k))),
  };
}

/** A managed dashboard lists one view per kind, so it follows the kinds; an install without one does not get one. */
async function refreshDashboard(plan) {
  const notesAbsolute = resolveNotesDir(plan.root, plan.notesDir), vault = vaultRootOf(notesAbsolute);
  if (!vault) return [];
  const steps = (await planExtras(vault, notesAbsolute, selectedKinds(plan.selection))).filter(s => path.basename(s.path) === baseName && s.action === 'update');
  await writeExtras(steps);
  return steps;
}

/**
 * Everything one update does: the block, with any instruction-like kind names migrated, and the cleanup of the
 * notes that goes with it. Nothing is written; the wizard, a dry run and a real run all start here.
 */
async function planUpdate(project, installed, selection) {
  const migrated = migrateSelection(selection);
  const plan = await planInstall(project, installed.notesDir, migrated.selection, {headless: installed.headless});
  const cleanup = await planCleanup({root: plan.root, notesDir: plan.notesDir, before: installed.selection, after: plan.selection, migrations: migrated.migrations});
  // Kinds are compared after migration, so a renamed kind reads as migrated, not as one removed and one added.
  return {plan, cleanup, migrations: migrated.migrations, ...kindChanges(migrateSelection(installed.selection).selection, plan.selection)};
}

/** How a cleanup reads in a report and in the review: paths are shown from the notes folder. */
function describeCleanup(update, {dry = false} = {}) {
  const {cleanup, migrations} = update, rel = p => path.relative(cleanup.notes, p).split(path.sep).join('/') || '.';
  const summary = [
    ...migrations.map(m => `${dry ? 'Would migrate' : 'Migrated'}: "${m.from.name}" → ${m.to.name}; the rest of the old name now leads its instructions`),
    ...(cleanup.moves.length ? [`${dry ? 'Would move' : 'Moved'} ${cleanup.moves.length} ${cleanup.moves.length === 1 ? 'note' : 'notes'} into folders:`,
      ...cleanup.moves.map(m => `  ${rel(m.from)} → ${rel(m.to)}`)] : []),
    ...(cleanup.edits.length ? [`${dry ? 'Would rewrite' : 'Rewrote'} links or tags in ${cleanup.edits.length} ${cleanup.edits.length === 1 ? 'note' : 'notes'}`] : []),
    ...cleanup.removals.map(r => `${dry ? 'Would remove' : 'Removed'}: ${rel(r.path)}${r.kind === 'folder' ? '/' : ''} (${r.reason})`),
    ...cleanup.skipped.map(x => `Kept in place: ${rel(x.path)} (${x.reason})`),
  ];
  const diffs = cleanup.edits.flatMap(e => ['', ...unifiedDiff(e.before, e.after, {name: rel(e.path)}).lines]);
  return {summary, diffs};
}

async function update() {
  const project = options.project ?? process.cwd();
  const installed = await installedFor(project);
  const up = await planUpdate(project, installed, selectionFrom(installed.selection));
  const {plan, cleanup, added, changed, removed} = up;
  const summaries = (await planSummaries({root: plan.root, notesDir: plan.notesDir, selection: plan.selection})).filter(s => s.action !== 'current');
  if (plan.change === 'current' && cleanupEmpty(cleanup) && !summaries.some(s => s.action !== 'keep (edited by you)')) {
    console.log(`Already current: ${plan.target}\nRecording: ${labels(plan.selection)}`);
    return;
  }
  const folder = k => `${plan.notesDir.replace(/\/+$/, '')}/${k.folder}`;
  const {summary, diffs} = describeCleanup(up, {dry: dryRun});
  const head = dryRun ? `Dry run, nothing written: ${plan.target}` : plan.change === 'current' ? `Already current: ${plan.target}` : `Updated: ${plan.target}`;
  console.log([head,
    ...added.map(k => `Added: ${k.label} (${folder(k)})`), ...changed.map(k => `Changed: ${k.label} (${folder(k)})`), ...removed.map(k => `Removed: ${k.label}`),
    `Recording: ${labels(plan.selection)}`, ...summary].join('\n'));
  if (dryRun && summaries.length) console.log(`Would rebuild ${summaryName} in: ${summaries.map(s => path.relative(cleanup.notes, path.dirname(s.path)) || '.').join(', ')}`);
  if (!dryRun) {
    if (await writeInstall(plan)) await verifyInstall(plan);
    await applyCleanup(cleanup);
    for (const s of await refreshSummaries(plan)) console.log(summaryLine(plan, s));
    for (const s of await refreshDashboard(plan)) console.log(`Obsidian ${s.label}: update ${s.path}`);
    console.log(`Verified: ${path.basename(plan.target)} reads back as written${cleanup.moves.length || cleanup.edits.length ? `; ${cleanup.moves.length} moved and ${cleanup.edits.length} edited notes are in place` : ''}`);
  }
  printDiff(plan);
  if (diffs.length) console.log(diffs.map(l => process.stdout.isTTY ? colorDiffLine(l) : l).join('\n'));
}

async function updateWizard() {
  const out = s => process.stdout.write(s + '\n');
  const project = options.project ?? process.cwd();
  const installed = await installedFor(project);
  out('');
  out(`${c.accent(glyph.done)}  ${c.bold('auto-note-taker update')}  ${c.dim('· change which kinds of notes agents keep')}`);
  out(c.accent(glyph.bar));
  const {root} = await readProject(project);
  out(`${c.green(glyph.done)}  ${c.dim('Project')}  ${displayPath(root, wide() + 18)}`);
  out(`${c.green(glyph.done)}  ${c.dim('Notes folder')}  ${displayPath(resolveNotesDir(root, installed.notesDir), wide() + 13)}`);
  let selection = installed.selection, up;
  for (;;) {
    try {
      selection = await chooseKinds(selection, {title: 'Record', back: false});
      up = await planUpdate(project, installed, selection);
      const {plan, cleanup, added, changed, removed, migrations} = up;
      const summaries = (await planSummaries({root: plan.root, notesDir: plan.notesDir, selection: plan.selection})).filter(s => s.action === 'create' || s.action === 'update');
      if (plan.change === 'current' && cleanupEmpty(cleanup) && !summaries.length) { out(c.dim('   Nothing changed.')); return; }
      const folder = k => displayPath(resolveNotesDir(plan.root, plan.notesDir) + '/' + k.folder, wide());
      const rows = (key, list) => list.flatMap((k, i) => [`${c.dim((i ? '' : key).padEnd(8))}  ${k.label}  ${c.dim('→ ' + folder(k))}`,
        ...(k.custom && (key !== 'remove') ? [`${' '.repeat(8)}  ${c.dim('sections ' + k.sections.join(', '))}`] : [])]);
      const count = (n, one) => `${n} ${n === 1 ? one : one + 's'}`;
      const {summary, diffs} = describeCleanup(up, {dry: true});
      const confirmed = await confirmWithReview(plan, {title: 'Update?', detail: [
        ...rows('add', added), ...rows('change', changed), ...removed.map((k, i) => `${c.dim((i ? '' : 'remove').padEnd(8))}  ${k.label}  ${c.dim('· its notes stay')}`),
        ...migrations.map((m, i) => `${c.dim((i ? '' : 'migrate').padEnd(8))}  ${m.to.name}  ${c.dim('← ' + m.from.name)}`),
        ...listWrap(selectedKinds(plan.selection).map(k => k.label), wide() + 10).map((line, i) => `${c.dim((i ? '' : 'record').padEnd(8))}  ${line}`),
        ...(cleanup.moves.length || cleanup.edits.length ? [`${c.dim('notes   ')}  move ${count(cleanup.moves.length, 'note')} into folders, rewrite links in ${count(cleanup.edits.length, 'note')}`] : []),
        ...cleanup.removals.map((r, i) => `${c.dim((i ? '' : 'tidy').padEnd(8))}  remove ${path.relative(cleanup.notes, r.path)}${r.kind === 'folder' ? '/' : ''}  ${c.dim('· ' + r.reason)}`),
        ...(summaries.length || cleanup.moves.length ? [`${c.dim('summary ')}  rebuild ${summaryName} in each kind's folder`] : []),
        changesRow(plan, 'changes '),
      ]}, [...summary, ...diffs]);
      if (!confirmed) { out(c.dim('   Nothing changed.')); return; }
      break;
    } catch (e) { if (!(e instanceof Back)) throw e; process.stdout.write('\x1b[1A\r\x1b[J'); }
  }
  const {plan, cleanup, added, changed, removed} = up;
  if (await writeInstall(plan)) await verifyInstall(plan);
  await applyCleanup(cleanup);
  const summaries = await refreshSummaries(plan);
  const dashboard = await refreshDashboard(plan);
  out('');
  const room = text => Math.max(24, (process.stdout.columns || 80) - text.length - 6);
  if (plan.change !== 'current') {
    const stat = '  ' + diffStat(changesOf(plan));
    out(`${c.green(glyph.check)}  Updated block in ${displayPath(plan.target, room('Updated block in') - visibleLength(stat))}${stat}`);
  }
  if (cleanup.moves.length) out(`${c.green(glyph.check)}  Moved ${cleanup.moves.length} notes into folders`);
  if (cleanup.edits.length) out(`${c.green(glyph.check)}  Rewrote links or tags in ${cleanup.edits.length} notes`);
  for (const r of cleanup.removals) out(`${c.green(glyph.check)}  Removed ${displayPath(r.path, room('Removed'))}`);
  for (const s of summaries) if (s.action === 'create' || s.action === 'update')
    out(`${c.green(glyph.check)}  ${s.action === 'create' ? 'Created' : 'Updated'} ${displayPath(s.path, room('Created'))}`);
  for (const s of dashboard) out(`${c.green(glyph.check)}  Updated ${displayPath(s.path, room('Updated'))}`);
  out(`${c.green(glyph.check)}  Verified: everything reads back as written`);
  out('');
  printCommand(out, 'Same update without prompts:', [`${npx} update`, `--project ${quote(plan.root)}`,
    ...[...added, ...changed].flatMap(kindFlags), ...removed.map(k => `--remove-kind ${quote(k.custom ? k.label : k.id)}`)]);
  out('');
}

/**
 * Asks for a kind of your own: its name, when to record it, the sections each note has, and optionally how to
 * write it. `taken` holds the names already in use, so a kind is never listed twice.
 */
async function askCustomKind(taken) {
  const name = (await run(inputPrompt({transient: true, title: 'Name of the new kind', placeholder: 'for example: Perf wins',
    validate: v => validateText(v, 'the name') || (!folderFor(v) ? 'use letters or numbers' : '')
      || (taken.some(n => lower(n) === lower(v)) ? 'that kind already exists' : '')}))).trim();
  const when = (await run(inputPrompt({transient: true, title: `Record “${name}” when…`, placeholder: 'for example: a change measurably sped something up',
    validate: v => validateText(v, 'the description')}))).trim();
  const sections = parseSections(await run(inputPrompt({transient: true, title: `Sections of each “${name}” note, comma-separated`,
    initial: defaultCustomSections.join(', '), validate: v => validateSections(parseSections(v))})));
  const details = (await run(inputPrompt({transient: true, title: `How should agents write “${name}” notes?`,
    placeholder: 'optional; enter to skip. For example: also keep an index note linking every one',
    validate: v => v.trim() ? validateText(v, 'the description', maxDetails) : ''}))).trim();
  return {name, when, sections, ...(details ? {details} : {})};
}

/** The Record checklist: every built-in kind and every kind of your own, ticked as `selection` has them. */
async function chooseKinds(sel, {title, back}) {
  let custom = [...sel.customKinds];
  let ticked = [...sel.record, ...custom.map(k => 'custom:' + k.name)];
  for (;;) {
    const result = await run(checklistPrompt({title, min: 1, back, add: 'Add your own kind…', none: 'nothing', options: [
      ...kinds.map(k => ({label: k.label, hint: k.hint, value: k.id, checked: ticked.includes(k.id)})),
      ...custom.map(k => ({label: k.name, hint: k.when, value: 'custom:' + k.name, checked: ticked.includes('custom:' + k.name)})),
    ]}));
    ticked = result.checked;
    if (!result.add) break;
    try {
      const kind = await askCustomKind([...kinds.map(k => k.label), ...custom.map(k => k.name)]);
      custom.push(kind);
      ticked.push('custom:' + kind.name);
    } catch (e) { if (!(e instanceof Back)) throw e; }
  }
  return normalizeSelection({...sel, record: kinds.map(k => k.id).filter(id => ticked.includes(id)),
    customKinds: custom.filter(k => ticked.includes('custom:' + k.name))});
}

async function wizard() {
  const out = s => process.stdout.write(s + '\n');
  out('');
  out(`${c.accent(glyph.done)}  ${c.bold('auto-note-taker')}  ${c.dim('· have agents keep the notes you choose, in Obsidian')}`);
  out(c.accent(glyph.bar));
  const vaults = await knownVaults();
  const state = {project: options.project, notes: options['notes-dir']};
  const steps = [];
  if (!options.project) steps.push(chooseProject);
  if (!options['notes-dir']) steps.push(chooseNotes);
  steps.push(chooseRecord, chooseSkip, chooseExtras, confirmInstall);
  // A step returns 'skipped' when it had nothing to ask, so going back passes over it instead of bouncing forward.
  // A step that asked leaves exactly one summary line; going back to it erases that line before asking again.
  const printed = [];
  for (let i = 0, backward = false; i < steps.length;) {
    if (backward && printed[i]) { process.stdout.write('\x1b[1A\r\x1b[J'); printed[i] = false; }
    try {
      const result = await steps[i](state, vaults);
      printed[i] = result !== 'skipped';
      if (backward && result === 'skipped' && i > 0) { i--; continue; }
      backward = false; i++;
    } catch (e) { if (!(e instanceof Back)) throw e; backward = true; if (i > 0) i--; }
  }
  if (!state.confirmed) { out(c.dim('   Nothing changed.')); return; }

  const plan = state.plan;
  if (await writeInstall(plan)) await verifyInstall(plan);
  if (state.extraSteps && state.extras) await writeExtras(state.extraSteps);
  const summaries = await refreshSummaries(plan);
  out('');
  const verb = {create: 'Created', append: 'Added block to', update: 'Updated block in', current: 'Already current:'}[plan.change];
  const room = text => Math.max(24, (process.stdout.columns || 80) - text.length - 6);
  const stat = plan.change === 'current' ? '' : '  ' + diffStat(changesOf(plan));
  out(`${c.green(glyph.check)}  ${verb} ${displayPath(plan.target, room(verb) - visibleLength(stat))}${stat}`);
  for (const s of state.extras ? state.extraSteps ?? [] : []) if (s.action === 'create' || s.action === 'update')
    out(`${c.green(glyph.check)}  ${s.action === 'create' ? 'Created' : 'Updated'} ${displayPath(s.path, room('Created'))}`);
  for (const s of summaries) if (s.action === 'create' || s.action === 'update')
    out(`${c.green(glyph.check)}  ${s.action === 'create' ? 'Created' : 'Updated'} ${displayPath(s.path, room('Created'))}`);
  const styled = state.extras && state.extraSteps?.some(s => s.path.endsWith('.css') && s.action !== 'current');
  if (styled) out(c.dim(`   Reopen the vault in Obsidian if the snippet does not apply right away.`));
  out('');
  const sel = plan.selection;
  printCommand(out, 'Same install without prompts:', [npx, `--project ${quote(plan.root)}`, `--notes-dir ${quote(plan.notesDir)}`,
    `--record ${sel.record.join(',') || 'none'}`, ...selectedKinds(sel).filter(k => k.custom).flatMap(kindFlags),
    `--skip ${sel.skip.join(',') || 'none'}`, ...sel.customSkips.map(t => `--add-skip ${quote(t)}`),
    ...(state.extras ? ['--obsidian-extras'] : []), ...(headless ? ['--headless'] : [])]);
  out('');
}

async function chooseProject(state) {
  const cwd = process.cwd();
  const marker = ['AGENTS.md', 'CLAUDE.md', '.git'].find(f => existsSync(path.join(cwd, f)));
  const choice = await run(selectPrompt({title: 'Project', options: [
    {label: 'This folder', hint: displayPath(cwd, 44) + (marker ? `  · has ${marker}` : ''), value: 'cwd', summary: cwd},
    {label: 'Browse…', hint: 'pick a folder with the arrow keys', value: 'browse', transient: true},
    {label: 'Type a path…', value: 'type', transient: true},
  ]}));
  if (choice === 'cwd') state.project = cwd;
  else if (choice === 'browse') {
    state.project = await run(browsePrompt({title: 'Project folder', start: cwd, allowNew: false}));
  } else state.project = path.resolve(expandHome(await run(inputPrompt({title: 'Project path', initial: displayPath(cwd) + '/', complete: true,
    validate: v => isDirectory(path.resolve(expandHome(v))) ? '' : 'not an existing folder'}))));
}
const isDirectory = p => { try { return statSync(p).isDirectory(); } catch { return false; } };

async function chooseNotes(state, vaults) {
  const {root, prior} = await readProject(state.project);
  const current = installedNotesDir(prior);
  const options = [];
  if (current) options.push({label: 'Keep current', hint: current, value: {dir: current}, summary: current});
  options.push({label: 'In this project', hint: `./${defaultNotesDir}`, value: {dir: defaultNotesDir}, summary: `./${defaultNotesDir}`});
  for (const v of vaults.slice(0, 5)) options.push({label: `Obsidian · ${v.name}`, hint: displayPath(v.path, 44), value: {browse: v.path}, transient: true});
  options.push({label: 'Browse…', hint: 'start from the project', value: {browse: root}, transient: true});
  options.push({label: 'Type a path…', value: {type: true}, transient: true});
  for (;;) {
    const choice = await run(selectPrompt({title: 'Notes folder', options, back: true}));
    try {
      let absolute;
      if (choice.dir) absolute = resolveNotesDir(root, choice.dir);
      else if (choice.browse) {
        const picked = await run(browsePrompt({title: 'Notes folder', start: choice.browse}));
        absolute = typeof picked === 'string' ? picked : path.join(picked.newFolderIn, await run(inputPrompt({
          title: `New folder in ${displayPath(picked.newFolderIn, 40)}`, initial: defaultNotesDir,
          summaryTitle: 'Notes folder', summaryValue: name => path.join(picked.newFolderIn, name),
          validate: v => !v.trim() ? 'name the folder' : /[\\/`\r\n]/.test(v) ? 'use a single folder name without slashes or backticks' : ''})));
      } else absolute = path.resolve(root, expandHome(await run(inputPrompt({title: 'Notes path', placeholder: 'absolute, ~/…, or relative to the project',
        complete: true, base: root, validate: v => validateNotesDir(v)}))));
      state.notes = notesDirFor(root, absolute);
      return;
    } catch (e) { if (!(e instanceof Back)) throw e; }
  }
}

/** The selection this project had, the flags' version of it, or the defaults; read once per project. */
async function startingSelection(state) {
  if (state.selectionFor !== state.project) {
    const {prior} = await readProject(state.project);
    state.installed = installedConfig(prior);
    state.selection = selectionFrom(state.installed?.selection);
    state.selectionFor = state.project;
  }
  return state.selection;
}

async function chooseRecord(state) {
  const sel = await startingSelection(state);
  if (options.record) return 'skipped';
  state.selection = await chooseKinds(sel, {title: 'Record', back: true});
}

async function chooseSkip(state) {
  const sel = await startingSelection(state);
  if (options.skip) return 'skipped';
  let custom = [...sel.customSkips];
  let ticked = [...sel.skip, ...custom.map(t => 'custom:' + t)];
  for (;;) {
    const result = await run(checklistPrompt({title: 'Never record', back: true, add: 'Add your own rule…', options: [
      ...exclusions.map(e => ({label: e.label, hint: e.hint, value: e.id, checked: ticked.includes(e.id)})),
      ...custom.map(t => ({label: t, value: 'custom:' + t, checked: ticked.includes('custom:' + t)})),
    ]}));
    ticked = result.checked;
    if (!result.add) break;
    try {
      const rule = await run(inputPrompt({transient: true, title: 'Never record…', placeholder: 'for example: anything about the CI provider',
        validate: v => validateText(v, 'the rule') || (custom.includes(v.trim()) ? 'that rule is already listed' : '')}));
      custom.push(rule.trim());
      ticked.push('custom:' + rule.trim());
    } catch (e) { if (!(e instanceof Back)) throw e; }
  }
  state.selection = normalizeSelection({...sel, skip: exclusions.map(e => e.id).filter(id => ticked.includes(id)),
    customSkips: custom.filter(t => ticked.includes('custom:' + t))});
}

async function chooseExtras(state) {
  const plan = await planInstall(state.project, state.notes ?? options['notes-dir'], state.selection, {headless});
  state.plan = plan;
  const notesAbsolute = resolveNotesDir(plan.root, plan.notesDir), vault = vaultRootOf(notesAbsolute);
  state.extraSteps = null;
  state.extras = extras;
  if (!vault || extras === false) return 'skipped';
  state.extraSteps = await planExtras(vault, notesAbsolute, selectedKinds(plan.selection));
  const pending = state.extraSteps.filter(s => s.action === 'create' || s.action === 'update');
  if (!pending.length) { state.extras = false; return 'skipped'; }
  if (extras === true) return 'skipped';
  const room = Math.max(24, (process.stdout.columns || 80) - 36);
  const rel = p => displayPath(path.relative(vault, p), room);
  state.extras = await run(confirmPrompt({title: `Add styling and a dashboard to vault “${path.basename(vault)}”?`, detail: [
    c.dim('Status banners, chat-style quotes, and a dashboard of every note.'),
    ...pending.map(s => `${c.accent(s.action === 'create' ? '+' : '~')} ${rel(s.path)}  ${c.dim(s.label)}`),
  ]}));
}

function wide() { return Math.max(30, (process.stdout.columns || 80) - 30); }

async function confirmInstall(state) {
  const plan = state.plan;
  const what = {create: 'create', append: 'add block', update: 'update block', current: 'already current'}[plan.change];
  const notesAbsolute = resolveNotesDir(plan.root, plan.notesDir);
  const skipped = [...plan.selection.skip.map(id => exclusions.find(e => e.id === id).label), ...plan.selection.customSkips];
  const chosen = selectedKinds(plan.selection);
  // Lists wrap between items, so no label is ever cut off; the key column stays aligned.
  const rows = (key, labels, separator = ', ') => listWrap(labels, wide() + 10, separator).map((line, i) => `${c.dim((i ? '' : key).padEnd(12))}  ${line}`);
  state.confirmed = await confirmWithReview(plan, {title: 'Install?', detail: [
    `${c.dim('instructions')}  ${displayPath(plan.target, wide())}  ${c.dim('· ' + what)}`,
    `${c.dim('notes       ')}  ${displayPath(notesAbsolute, wide())}${existsSync(notesAbsolute) ? '' : c.dim('  · new')}`,
    ...rows('record', chosen.map(k => k.label)),
    ...rows('folders', chosen.map(k => k.folder === '.' ? '(the notes folder)' : k.folder + '/'), '  '),
    `${c.dim('ask first   ')}  ${headless ? 'no, agents write notes without asking (--headless)' : 'yes, a Yes/No question before each note'}`,
    ...(skipped.length ? rows('never record', skipped) : [`${c.dim('never record')}  ${c.dim('nothing excluded')}`]),
    changesRow(plan, 'changes     '),
  ]});
}

// Runs last, so every helper above is defined before a prompt can call it.
try {
  parse();
  const terminal = process.stdin.isTTY && process.stdout.isTTY && !yes;
  if (updating) {
    if (terminal && !dryRun && !options.addKind.length && !options.addRecord.length && !options.removeKind.length) await updateWizard();
    else await update();
  } else if (terminal && !check && !(options.project && options['notes-dir'])) await wizard();
  else await direct();
} catch (error) {
  if (error instanceof Cancelled) { process.exitCode = 130; }
  else { console.error(`auto-note-taker: ${error.message}`); process.exitCode = 1; }
}
