#!/usr/bin/env node
import {existsSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultNotesDir, expandHome, installedConfig, installedNotesDir, notesDirFor, planInstall, readProject, resolveNotesDir, validateNotesDir, writeInstall} from '../lib/install.mjs';
import {defaultCustomSections, defaultRecord, defaultSkip, exclusions, folderFor, kindById, kinds, maxDetails, normalizeSelection, parseSections, selectedKinds, validateSections, validateText} from '../lib/kinds.mjs';
import {baseName, knownVaults, planExtras, vaultRootOf, writeExtras} from '../lib/obsidian.mjs';
import {Back, Cancelled, browsePrompt, c, checklistPrompt, confirmPrompt, displayPath, glyph, inputPrompt, listWrap, run, selectPrompt} from '../lib/ui.mjs';

const npx = 'npx --yes github:andyqioe/auto-note-taker';
const usage = `Usage: auto-note-taker [--project PATH] [--notes-dir PATH] [--record KINDS] [--skip ITEMS] [--add-kind KIND]...
                       [--add-skip TEXT]... [--obsidian-extras | --no-obsidian-extras] [--headless] [--yes] [--check]
       auto-note-taker update [--project PATH] [--add-kind KIND [--kind-sections LIST] [--kind-details TEXT]]...
                       [--remove-kind KIND]... [--yes]

Installs or updates one managed block in AGENTS.md telling agents which moments to record as Obsidian notes,
and which to leave out. Run in a terminal with no flags to choose everything interactively.

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
  --check                 report whether the block is current, without writing

update changes only which kinds an existing install records, and keeps its notes folder, exclusions and
headless setting. In a terminal with no kinds named, it asks which to add or remove.

  --add-kind KIND         as above; giving a kind of your own a name it already has replaces its definition
  --remove-kind KIND      stop recording a kind, by id or name; its notes stay where they are`;

const args = process.argv.slice(2);
const updating = args[0] === 'update';
if (updating) args.shift();
const options = {addKind: [], addRecord: [], removeKind: [], addSkip: []};
let check = false, yes = false, headless = false, extras;
const list = v => v === 'none' ? [] : v.split(',').map(x => x.trim()).filter(Boolean);
const valueFlags = ['--project', '--notes-dir', '--record', '--skip', '--add-kind', '--kind-sections', '--kind-details', '--add-skip', '--remove-kind'];
// update edits the kinds of an install and nothing else, so flags that would change the rest of it are refused.
const updateFlags = ['--project', '--add-kind', '--kind-sections', '--kind-details', '--remove-kind', '--yes', '-y', '--help', '-h'];
function parse() {
  let ownKind = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (updating && !updateFlags.includes(arg) && arg.startsWith('-'))
      throw new Error(`update only adds or removes kinds; run the installer without "update" to use ${arg}`);
    if (arg === '--help' || arg === '-h') { console.log(usage); process.exit(0); }
    if (arg === '--check') { check = true; continue; }
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

async function direct() {
  const {prior} = await readProject(options.project ?? process.cwd());
  const installed = installedConfig(prior);
  const plan = await planInstall(options.project ?? process.cwd(), options['notes-dir'] ?? installed?.notesDir ?? defaultNotesDir, selectionFrom(installed?.selection), {headless});
  if (check) {
    console.log(plan.change === 'current' ? 'Context is current.' : 'Context is missing or out of date.');
    process.exitCode = plan.change === 'current' ? 0 : 1;
    return;
  }
  if (await writeInstall(plan)) console.log(`Installed: ${plan.target}\nNotes: ${plan.notesDir}\nRecording: ${labels(plan.selection)}\nAsk before each note: ${headless ? 'no (headless)' : 'yes'}`);
  else console.log(`Already installed: ${plan.target}`);
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

async function update() {
  const project = options.project ?? process.cwd();
  if (!options.addKind.length && !options.addRecord.length && !options.removeKind.length)
    throw new Error('update needs a kind to add (--add-kind) or remove (--remove-kind), or a terminal to choose one in');
  const installed = await installedFor(project);
  const plan = await planInstall(project, installed.notesDir, selectionFrom(installed.selection), {headless: installed.headless});
  if (!(await writeInstall(plan))) { console.log(`Already current: ${plan.target}\nRecording: ${labels(plan.selection)}`); return; }
  const {added, changed, removed} = kindChanges(installed.selection, plan.selection);
  const folder = k => `${plan.notesDir.replace(/\/+$/, '')}/${k.folder}`;
  console.log([`Updated: ${plan.target}`,
    ...added.map(k => `Added: ${k.label} (${folder(k)})`), ...changed.map(k => `Changed: ${k.label} (${folder(k)})`), ...removed.map(k => `Removed: ${k.label}`),
    `Recording: ${labels(plan.selection)}`].join('\n'));
  for (const s of await refreshDashboard(plan)) console.log(`Obsidian ${s.label}: update ${s.path}`);
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
  let selection = installed.selection, plan;
  for (;;) {
    try {
      selection = await chooseKinds(selection, {title: 'Record', back: false});
      plan = await planInstall(project, installed.notesDir, selection, {headless: installed.headless});
      const {added, changed, removed} = kindChanges(installed.selection, plan.selection);
      if (!added.length && !changed.length && !removed.length) { out(c.dim('   Nothing changed.')); return; }
      const folder = k => displayPath(resolveNotesDir(plan.root, plan.notesDir) + '/' + k.folder, wide());
      const rows = (key, list) => list.flatMap((k, i) => [`${c.dim((i ? '' : key).padEnd(8))}  ${k.label}  ${c.dim('→ ' + folder(k))}`,
        ...(k.custom && (key !== 'remove') ? [`${' '.repeat(8)}  ${c.dim('sections ' + k.sections.join(', '))}`] : [])]);
      const confirmed = await run(confirmPrompt({title: 'Update?', detail: [
        ...rows('add', added), ...rows('change', changed), ...removed.map((k, i) => `${c.dim((i ? '' : 'remove').padEnd(8))}  ${k.label}  ${c.dim('· its notes stay')}`),
        ...listWrap(selectedKinds(plan.selection).map(k => k.label), wide() + 10).map((line, i) => `${c.dim((i ? '' : 'record').padEnd(8))}  ${line}`),
      ]}));
      if (!confirmed) { out(c.dim('   Nothing changed.')); return; }
      break;
    } catch (e) { if (!(e instanceof Back)) throw e; process.stdout.write('\x1b[1A\r\x1b[J'); }
  }
  await writeInstall(plan);
  const dashboard = await refreshDashboard(plan);
  out('');
  const room = text => Math.max(24, (process.stdout.columns || 80) - text.length - 6);
  out(`${c.green(glyph.check)}  Updated block in ${displayPath(plan.target, room('Updated block in'))}`);
  for (const s of dashboard) out(`${c.green(glyph.check)}  Updated ${displayPath(s.path, room('Updated'))}`);
  out('');
  const {added, changed, removed} = kindChanges(installed.selection, plan.selection);
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
  await writeInstall(plan);
  if (state.extraSteps && state.extras) await writeExtras(state.extraSteps);
  out('');
  const verb = {create: 'Created', append: 'Added block to', update: 'Updated block in', current: 'Already current:'}[plan.change];
  const room = text => Math.max(24, (process.stdout.columns || 80) - text.length - 6);
  out(`${c.green(glyph.check)}  ${verb} ${displayPath(plan.target, room(verb))}`);
  for (const s of state.extras ? state.extraSteps ?? [] : []) if (s.action === 'create' || s.action === 'update')
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
  state.confirmed = await run(confirmPrompt({title: 'Install?', detail: [
    `${c.dim('instructions')}  ${displayPath(plan.target, wide())}  ${c.dim('· ' + what)}`,
    `${c.dim('notes       ')}  ${displayPath(notesAbsolute, wide())}${existsSync(notesAbsolute) ? '' : c.dim('  · new')}`,
    ...rows('record', chosen.map(k => k.label)),
    ...rows('folders', chosen.map(k => k.folder === '.' ? '(the notes folder)' : k.folder + '/'), '  '),
    `${c.dim('ask first   ')}  ${headless ? 'no, agents write notes without asking (--headless)' : 'yes, a Yes/No question before each note'}`,
    ...(skipped.length ? rows('never record', skipped) : [`${c.dim('never record')}  ${c.dim('nothing excluded')}`]),
  ]}));
}

// Runs last, so every helper above is defined before a prompt can call it.
try {
  parse();
  const terminal = process.stdin.isTTY && process.stdout.isTTY && !yes;
  if (updating) {
    if (terminal && !options.addKind.length && !options.addRecord.length && !options.removeKind.length) await updateWizard();
    else await update();
  } else if (terminal && !check && !(options.project && options['notes-dir'])) await wizard();
  else await direct();
} catch (error) {
  if (error instanceof Cancelled) { process.exitCode = 130; }
  else { console.error(`auto-note-taker: ${error.message}`); process.exitCode = 1; }
}
