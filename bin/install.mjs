#!/usr/bin/env node
import {existsSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultNotesDir, expandHome, installedNotesDir, notesDirFor, planInstall, readProject, resolveNotesDir, validateNotesDir, writeInstall} from '../lib/install.mjs';
import {knownVaults, planExtras, vaultRootOf, writeExtras} from '../lib/obsidian.mjs';
import {Back, Cancelled, browsePrompt, c, confirmPrompt, displayPath, glyph, inputPrompt, run, selectPrompt} from '../lib/ui.mjs';

const usage = `Usage: auto-note-taker [--project PATH] [--notes-dir PATH] [--obsidian-extras | --no-obsidian-extras] [--yes] [--check]

Installs or updates one managed block in AGENTS.md telling agents to record tactical direction as Obsidian notes.
Run in a terminal with no flags to pick the project and notes folder interactively.

  --project PATH          project whose AGENTS.md receives the block (default: current directory)
  --notes-dir PATH        where notes go; relative paths are inside the project (default: "${defaultNotesDir}")
  --obsidian-extras       also install the note styling snippet and a Bases dashboard into the notes' vault
  --no-obsidian-extras    never offer them
  --yes, -y               do not prompt; use defaults for anything not given
  --check                 report whether the block is current, without writing`;

const args = process.argv.slice(2);
const options = {};
let check = false, yes = false, extras;
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(usage); process.exit(0); }
    if (arg === '--check') { check = true; continue; }
    if (arg === '--yes' || arg === '-y') { yes = true; continue; }
    if (arg === '--obsidian-extras' || arg === '--no-obsidian-extras') { extras = arg === '--obsidian-extras'; continue; }
    if (!['--project', '--notes-dir'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${arg}`);
    options[arg.slice(2)] = args[++i];
  }
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !check && !yes && !(options.project && options['notes-dir']);
  if (interactive) await wizard();
  else await direct();
} catch (error) {
  if (error instanceof Cancelled) { process.exitCode = 130; }
  else { console.error(`auto-note-taker: ${error.message}`); process.exitCode = 1; }
}

async function direct() {
  const plan = await planInstall(options.project ?? process.cwd(), options['notes-dir'] ?? defaultNotesDir);
  if (check) {
    console.log(plan.change === 'current' ? 'Context is current.' : 'Context is missing or out of date.');
    process.exitCode = plan.change === 'current' ? 0 : 1;
    return;
  }
  if (await writeInstall(plan)) console.log(`Installed: ${plan.target}\nTactical notes: ${plan.notesDir}`);
  else console.log(`Already installed: ${plan.target}`);
  if (extras) {
    const notesAbsolute = resolveNotesDir(plan.root, plan.notesDir), vault = vaultRootOf(notesAbsolute);
    if (!vault) console.log('Obsidian extras skipped: the notes folder is not inside an Obsidian vault.');
    else { const steps = await planExtras(vault, notesAbsolute); await writeExtras(steps); steps.forEach(s => console.log(`Obsidian ${s.label}: ${s.action} ${s.path}`)); }
  }
}

async function wizard() {
  const out = s => process.stdout.write(s + '\n');
  out('');
  out(`${c.accent(glyph.done)}  ${c.bold('auto-note-taker')}  ${c.dim('· record tactical direction as Obsidian notes')}`);
  out(c.accent(glyph.bar));
  const vaults = await knownVaults();
  const state = {project: options.project, notes: options['notes-dir']};
  const steps = [];
  if (!options.project) steps.push(chooseProject);
  if (!options['notes-dir']) steps.push(chooseNotes);
  steps.push(chooseExtras, confirmInstall);
  // A step returns 'skipped' when it had nothing to ask, so going back passes over it instead of bouncing forward.
  for (let i = 0, backward = false; i < steps.length;) {
    try {
      const result = await steps[i](state, vaults);
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
  const command = ['npx --yes github:andyqioe/auto-note-taker', `--project ${quote(plan.root)}`, `--notes-dir ${quote(plan.notesDir)}`,
    ...(state.extras ? ['--obsidian-extras'] : [])];
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

async function chooseExtras(state) {
  const plan = await planInstall(state.project, state.notes);
  state.plan = plan;
  const notesAbsolute = resolveNotesDir(plan.root, plan.notesDir), vault = vaultRootOf(notesAbsolute);
  state.extraSteps = null;
  state.extras = extras;
  if (!vault || extras === false) return 'skipped';
  state.extraSteps = await planExtras(vault, notesAbsolute);
  const pending = state.extraSteps.filter(s => s.action === 'create' || s.action === 'update');
  if (!pending.length) { state.extras = false; return 'skipped'; }
  if (extras === true) return 'skipped';
  const room = Math.max(24, (process.stdout.columns || 80) - 36);
  const rel = p => displayPath(path.relative(vault, p), room);
  state.extras = await run(confirmPrompt({title: `Add styling and a dashboard to vault “${path.basename(vault)}”?`, detail: [
    c.dim('Colored status banner, chat-style exchange, and a dashboard of every decision.'),
    ...pending.map(s => `${c.accent(s.action === 'create' ? '+' : '~')} ${rel(s.path)}  ${c.dim(s.label)}`),
  ]}));
}

function wide() { return Math.max(30, (process.stdout.columns || 80) - 30); }

async function confirmInstall(state) {
  const plan = state.plan;
  const what = {create: 'create', append: 'add block', update: 'update block', current: 'already current'}[plan.change];
  const notesAbsolute = resolveNotesDir(plan.root, plan.notesDir);
  state.confirmed = await run(confirmPrompt({title: 'Install?', detail: [
    `${c.dim('instructions')}  ${displayPath(plan.target, wide())}  ${c.dim('· ' + what)}`,
    `${c.dim('notes       ')}  ${displayPath(notesAbsolute, wide())}${existsSync(notesAbsolute) ? '' : c.dim('  · new')}`,
  ]}));
}
