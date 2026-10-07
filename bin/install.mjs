#!/usr/bin/env node
import {existsSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultNotesDir, expandHome, installedConfig, installedNotesDir, notesDirFor, planInstall, readProject, resolveNotesDir, validateNotesDir, writeInstall} from '../lib/install.mjs';
import {defaultRecord, defaultSkip, exclusions, folderFor, kinds, normalizeSelection, selectedKinds, validateText} from '../lib/kinds.mjs';
import {knownVaults, planExtras, vaultRootOf, writeExtras} from '../lib/obsidian.mjs';
import {Back, Cancelled, browsePrompt, c, checklistPrompt, confirmPrompt, displayPath, glyph, inputPrompt, listWrap, run, selectPrompt} from '../lib/ui.mjs';

const usage = `Usage: auto-note-taker [--project PATH] [--notes-dir PATH] [--record KINDS] [--skip ITEMS] [--add-kind "NAME=WHEN"]...
                       [--add-skip TEXT]... [--obsidian-extras | --no-obsidian-extras] [--headless] [--yes] [--check]

Installs or updates one managed block in AGENTS.md telling agents which moments to record as Obsidian notes,
and which to leave out. Run in a terminal with no flags to choose everything interactively.

  --project PATH          project whose AGENTS.md receives the block (default: current directory)
  --notes-dir PATH        where notes go, one subfolder per kind; relative paths are inside the project
                          (default: the folder chosen last time, else "${defaultNotesDir}")
  --record KINDS          comma-separated kinds to record, or "none" (default: last choice, else ${defaultRecord.join(',')})
                          ${kinds.map(k => k.id).join(', ')}
  --skip ITEMS            comma-separated things never to record, or "none" (default: last choice, else ${defaultSkip.join(',')})
                          ${exclusions.map(e => e.id).join(', ')}
  --add-kind "NAME=WHEN"  also record a kind of your own, for example "Perf wins=a change measurably sped something up"
  --add-skip TEXT         also never record this, in your words
  --obsidian-extras       also install the note styling snippet and a Bases dashboard into the notes' vault
  --no-obsidian-extras    never offer them
  --headless              let agents write notes without asking; by default they ask a Yes/No question before each
                          note. Pass it on every run that should stay headless, --check included
  --yes, -y               do not prompt; use defaults for anything not given
  --check                 report whether the block is current, without writing`;

const args = process.argv.slice(2);
const options = {addKind: [], addSkip: []};
let check = false, yes = false, headless = false, extras;
const list = v => v === 'none' ? [] : v.split(',').map(x => x.trim()).filter(Boolean);
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(usage); process.exit(0); }
    if (arg === '--check') { check = true; continue; }
    if (arg === '--yes' || arg === '-y') { yes = true; continue; }
    if (arg === '--headless') { headless = true; continue; }
    if (arg === '--obsidian-extras' || arg === '--no-obsidian-extras') { extras = arg === '--obsidian-extras'; continue; }
    if (!['--project', '--notes-dir', '--record', '--skip', '--add-kind', '--add-skip'].includes(arg) || args[i + 1] === undefined || args[i + 1].startsWith('--'))
      throw new Error(`Invalid argument: ${arg}`);
    const value = args[++i];
    if (arg === '--record' || arg === '--skip') options[arg.slice(2)] = list(value);
    else if (arg === '--add-kind') {
      const at = value.indexOf('=');
      if (at < 1) throw new Error('--add-kind takes "NAME=WHEN", for example "Perf wins=a change measurably sped something up"');
      options.addKind.push({name: value.slice(0, at).trim(), when: value.slice(at + 1).trim()});
    } else if (arg === '--add-skip') options.addSkip.push(value);
    else options[arg.slice(2)] = value;
  }
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !check && !yes && !(options.project && options['notes-dir']);
  if (interactive) await wizard();
  else await direct();
} catch (error) {
  if (error instanceof Cancelled) { process.exitCode = 130; }
  else { console.error(`auto-note-taker: ${error.message}`); process.exitCode = 1; }
}

/**
 * The selection flags ask for, on top of what the project chose last time: --record and --skip replace a list
 * (and the custom kinds or rules that went with it), --add-kind and --add-skip extend it.
 */
function selectionFrom(prior) {
  const base = prior ?? {record: defaultRecord, skip: defaultSkip, customKinds: [], customSkips: [], folders: {}};
  return normalizeSelection({
    record: options.record ?? base.record, folders: base.folders,
    customKinds: [...(options.record ? [] : base.customKinds), ...options.addKind],
    skip: options.skip ?? base.skip, customSkips: [...(options.skip ? [] : base.customSkips), ...options.addSkip],
  });
}
function labels(selection) { return selectedKinds(selection).map(k => k.label).join(', '); }

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
  // Paths under home print as "$HOME/…" so the command stays short and still works when pasted into a shell.
  const quote = s => {
    const home = os.homedir();
    if (s.startsWith(home + path.sep)) return `"$HOME/${s.slice(home.length + 1).replace(/["\\$`]/g, '\\$&')}"`;
    return /^[\w./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
  };
  out(c.dim('   Same install without prompts:'));
  // One flag per line, joined with backslashes, so long paths never wrap mid-word and the block still pastes as one command.
  const sel = plan.selection;
  const command = ['npx --yes github:andyqioe/auto-note-taker', `--project ${quote(plan.root)}`, `--notes-dir ${quote(plan.notesDir)}`,
    `--record ${sel.record.join(',') || 'none'}`, ...sel.customKinds.map(k => `--add-kind ${quote(`${k.name}=${k.when}`)}`),
    `--skip ${sel.skip.join(',') || 'none'}`, ...sel.customSkips.map(t => `--add-skip ${quote(t)}`),
    ...(state.extras ? ['--obsidian-extras'] : []), ...(headless ? ['--headless'] : [])];
  out(c.dim(command.map((part, i) => `   ${i ? '  ' : ''}${part}`).join(' \\\n')));
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
  let custom = [...sel.customKinds];
  let ticked = [...sel.record, ...custom.map(k => 'custom:' + k.name)];
  for (;;) {
    const result = await run(checklistPrompt({title: 'Record', min: 1, back: true, add: 'Add your own kind…', none: 'nothing', options: [
      ...kinds.map(k => ({label: k.label, hint: k.hint, value: k.id, checked: ticked.includes(k.id)})),
      ...custom.map(k => ({label: k.name, hint: k.when, value: 'custom:' + k.name, checked: ticked.includes('custom:' + k.name)})),
    ]}));
    ticked = result.checked;
    if (!result.add) break;
    try {
      const name = await run(inputPrompt({transient: true, title: 'Name of the new kind', placeholder: 'for example: Perf wins',
        validate: v => validateText(v, 'the name') || (!folderFor(v) ? 'use letters or numbers' : '')
          || ([...kinds.map(k => k.label), ...custom.map(k => k.name)].some(n => n.toLowerCase() === v.trim().toLowerCase()) ? 'that kind already exists' : '')}));
      const when = await run(inputPrompt({transient: true, title: `Record “${name.trim()}” when…`, placeholder: 'for example: a change measurably sped something up',
        validate: v => validateText(v, 'the description')}));
      custom.push({name: name.trim(), when: when.trim()});
      ticked.push('custom:' + name.trim());
    } catch (e) { if (!(e instanceof Back)) throw e; }
  }
  custom = custom.filter(k => ticked.includes('custom:' + k.name));
  state.selection = normalizeSelection({...sel, record: kinds.map(k => k.id).filter(id => ticked.includes(id)), customKinds: custom});
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
