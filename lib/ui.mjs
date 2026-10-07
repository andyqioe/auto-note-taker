// Dependency-free terminal prompts. Each prompt is a pure state machine (init, key, view) driven by run(),
// so the logic is testable without a TTY and the renderer only redraws what the state describes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class Cancelled extends Error { constructor() { super('Cancelled'); } }
export class Back extends Error { constructor() { super('Back'); } }

const env = process.env;
const colorOn = !('NO_COLOR' in env) && env.TERM !== 'dumb';
const truecolor = /truecolor|24bit/i.test(env.COLORTERM || '');
const sgr = (open, close) => s => colorOn ? `\x1b[${open}m${s}\x1b[${close}m` : String(s);
export const c = {
  accent: sgr(truecolor ? '38;2;129;140;248' : '38;5;105', 39),
  bold: sgr(1, 22), dim: sgr(2, 22), green: sgr(32, 39), yellow: sgr(33, 39), red: sgr(31, 39), inverse: sgr(7, 27),
};
export const glyph = {done: '◆', active: '◇', pointer: '❯', bar: '│', end: '└', check: '✓', vault: '◈'};

const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const visibleLength = s => [...s.replace(ansi, '')].length;
/** Shortens a path for display: home becomes ~ and the middle collapses to … to fit `max` columns. */
export function displayPath(p, max = Infinity) {
  const home = os.homedir();
  let s = p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
  if ([...s].length <= max) return s;
  const chars = [...s], keep = Math.max(1, max - 1), head = Math.ceil(keep / 3);
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - (keep - head)).join('');
}
/** Cuts a styled line to `width` visible columns so it never wraps (wrapping would break redraw arithmetic). */
export function fit(line, width) {
  if (visibleLength(line) <= width) return line;
  let out = '', seen = 0;
  for (const part of line.split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
    if (part.startsWith('\x1b[')) { out += part; continue; }
    for (const ch of part) { if (seen >= width - 1) return out + '…' + (colorOn ? '\x1b[0m' : ''); out += ch; seen++; }
  }
  return out;
}

export function parseKeys(data) {
  const keys = [], s = data.toString('utf8');
  const named = {'\x1b[A': 'up', '\x1bOA': 'up', '\x1b[B': 'down', '\x1bOB': 'down', '\x1b[C': 'right', '\x1bOC': 'right',
    '\x1b[D': 'left', '\x1bOD': 'left', '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[5~': 'pageup', '\x1b[6~': 'pagedown'};
  for (let i = 0; i < s.length;) {
    const seq = Object.keys(named).find(k => s.startsWith(k, i));
    if (seq) { keys.push({name: named[seq]}); i += seq.length; continue; }
    const ch = s[i++];
    if (ch === '\x1b') { if (s[i] === '[') { while (i < s.length && !/[A-Za-z~]/.test(s[i])) i++; i++; continue; } keys.push({name: 'escape'}); }
    else if (ch === '\r' || ch === '\n') keys.push({name: 'enter'});
    else if (ch === '\t') keys.push({name: 'tab'});
    else if (ch === '\x7f' || ch === '\b') keys.push({name: 'backspace'});
    else if (ch === '\x03') keys.push({name: 'ctrl-c'});
    else if (ch === '\x15') keys.push({name: 'ctrl-u'});
    else if (ch >= ' ') keys.push({name: 'char', ch});
  }
  return keys;
}

/** A finished step collapses to one line; paths shrink from the middle so the folder name stays visible. */
const step = (title, value) => width => `${c.green(glyph.done)}  ${c.dim(title)}  ${/^[/~]/.test(value) ? displayPath(value, width - visibleLength(title) - 5) : value}`;

// ---- select -------------------------------------------------------------------------------------------------

export const selectPrompt = ({title, options, initial = 0, back = false}) => ({
  init: () => ({cursor: Math.min(initial, options.length - 1)}),
  key(state, key) {
    const n = options.length;
    if (key.name === 'up' || key.ch === 'k') return {cursor: (state.cursor - 1 + n) % n};
    if (key.name === 'down' || key.ch === 'j') return {cursor: (state.cursor + 1) % n};
    if (key.name === 'char' && /[1-9]/.test(key.ch) && +key.ch <= n) return {done: options[+key.ch - 1].value, cursor: +key.ch - 1};
    if (key.name === 'enter') return {...state, done: options[state.cursor].value};
    if (key.name === 'escape' || (back && key.name === 'left')) return {...state, back};
    return state;
  },
  view(state, width) {
    const label = Math.max(...options.map(o => visibleLength(o.label)));
    const lines = [`${c.accent(glyph.active)}  ${c.bold(title)}`];
    options.forEach((o, i) => {
      const on = i === state.cursor, pad = ' '.repeat(label - visibleLength(o.label));
      const hint = o.hint ? '  ' + c.dim(fit(o.hint, Math.max(8, width - label - 12))) : '';
      lines.push(`${c.accent(glyph.bar)}  ${on ? c.accent(glyph.pointer) + ' ' + c.bold(o.label) : '  ' + o.label}${pad}${hint}`);
    });
    lines.push(c.accent(glyph.end) + '  ' + c.dim(`↑↓ move · enter choose${back ? ' · esc back' : ''}`));
    return lines;
  },
  transient: (state) => options[state.cursor].transient,
  summary: (state) => step(title, options[state.cursor].summary ?? options[state.cursor].label),
});

/** Joins labels into one line of at most `width` columns, ending in "+N more" rather than cutting a label. */
export function listFit(labels, width) {
  for (let shown = labels.length; shown > 0; shown--) {
    const more = labels.length - shown, text = labels.slice(0, shown).join(', ') + (more ? `, +${more} more` : '');
    if (visibleLength(text) <= width) return text;
  }
  return labels.length ? `${labels.length} chosen` : '';
}

/** Lays labels out over as many lines of at most `width` columns as they need, never splitting one. */
export function listWrap(labels, width, separator = ', ') {
  const lines = [];
  for (const label of labels) {
    const last = lines.length - 1;
    if (last >= 0 && visibleLength(lines[last] + separator + label) <= width) lines[last] += separator + label;
    else lines.push(label);
  }
  return lines;
}

// ---- checklist ----------------------------------------------------------------------------------------------

/**
 * Several choices at once: space ticks, enter confirms. An optional last row ("Add your own…") ends the prompt
 * with {add: true} so the caller can ask for the new item and come back with it ticked.
 */
export const checklistPrompt = ({title, options, add, min = 0, back = false, none = 'none'}) => ({
  init: () => ({cursor: 0, checked: options.filter(o => o.checked).map(o => o.value), error: ''}),
  key(state, key) {
    const n = options.length + (add ? 1 : 0);
    const move = cursor => ({...state, cursor, error: ''});
    if (key.name === 'up' || key.ch === 'k') return move((state.cursor - 1 + n) % n);
    if (key.name === 'down' || key.ch === 'j') return move((state.cursor + 1) % n);
    if (key.name === 'home') return move(0);
    if (key.name === 'end') return move(n - 1);
    const onAdd = add && state.cursor === options.length;
    if ((key.ch === ' ' || key.ch === 'x') && !onAdd) {
      const value = options[state.cursor].value;
      const ticked = state.checked.includes(value) ? state.checked.filter(v => v !== value) : [...state.checked, value];
      return {...state, checked: options.map(o => o.value).filter(v => ticked.includes(v)), error: ''};
    }
    if (key.name === 'enter') {
      if (onAdd) return {...state, done: {add: true, checked: state.checked}};
      if (state.checked.length < min) return {...state, error: `tick at least ${min} with space`};
      return {...state, done: {checked: state.checked}};
    }
    if (key.name === 'escape' || (back && key.name === 'left')) return {...state, back};
    return state;
  },
  view(state, width) {
    const label = Math.max(...options.map(o => visibleLength(o.label)), add ? visibleLength(add) : 0);
    const lines = [`${c.accent(glyph.active)}  ${c.bold(title)}`];
    options.forEach((o, i) => {
      const on = i === state.cursor, ticked = state.checked.includes(o.value);
      const box = ticked ? c.accent('◉') : c.dim('○'), pad = ' '.repeat(label - visibleLength(o.label));
      // the row is `│  ❯ ◉ <label>  <hint>`: 7 columns before the label, 2 between label and hint
      const hint = o.hint ? '  ' + c.dim(fit(o.hint, Math.max(8, width - label - 9))) : '';
      lines.push(`${c.accent(glyph.bar)}  ${on ? c.accent(glyph.pointer) : ' '} ${box} ${on ? c.bold(o.label) : o.label}${pad}${hint}`);
    });
    if (add) {
      const on = state.cursor === options.length;
      lines.push(`${c.accent(glyph.bar)}  ${on ? c.accent(glyph.pointer) : ' '} ${c.accent('+')} ${on ? c.bold(add) : c.dim(add)}`);
    }
    lines.push(state.error ? `${c.yellow(glyph.end)}  ${c.yellow(state.error)}`
      : c.accent(glyph.end) + '  ' + c.dim(`↑↓ move · space tick · enter confirm${back ? ' · esc back' : ''}`));
    return lines;
  },
  transient: (state) => state.done?.add,
  summary: (state) => width => step(title, listFit(options.filter(o => state.checked.includes(o.value)).map(o => o.label), width - visibleLength(title) - 6) || none)(width),
});

// ---- text input ---------------------------------------------------------------------------------------------

/** Completes the last path segment against existing directories (unique match, else longest common prefix). */
export function completePath(value, base = process.cwd()) {
  const expanded = value.startsWith('~') ? os.homedir() + value.slice(1) : value;
  const absolute = path.resolve(base, expanded);
  const [dir, partial] = expanded.endsWith('/') ? [absolute, ''] : [path.dirname(absolute), path.basename(absolute)];
  let names;
  try { names = listDirectories(dir).filter(n => n.toLowerCase().startsWith(partial.toLowerCase())); } catch { return value; }
  if (!names.length) return value;
  let prefix = names[0];
  for (const n of names) while (!n.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  const done = names.length === 1 ? names[0] + '/' : prefix;
  if (done.length < partial.length) return value;
  const cut = expanded.endsWith('/') ? value : value.slice(0, value.length - partial.length);
  return cut + done;
}

export const inputPrompt = ({title, initial = '', placeholder = '', validate = () => '', complete = false, base, summaryTitle = title, summaryValue = v => v, transient = false}) => ({
  init: () => ({value: initial, error: ''}),
  key(state, key) {
    if (key.name === 'char') return {value: state.value + key.ch, error: ''};
    if (key.name === 'backspace') return {value: [...state.value].slice(0, -1).join(''), error: ''};
    if (key.name === 'ctrl-u') return {value: '', error: ''};
    if (key.name === 'tab' && complete) return {value: completePath(state.value, base), error: ''};
    if (key.name === 'escape') return {...state, back: true};
    if (key.name === 'enter') { const error = validate(state.value); return error ? {...state, error} : {...state, done: state.value}; }
    return state;
  },
  view(state, width) {
    // Long input scrolls: the end, where the typing happens, stays in view and the start collapses to …
    const room = width - 4, chars = [...state.value];
    const shown = !state.value ? c.dim(placeholder) : chars.length <= room ? state.value : '…' + chars.slice(chars.length - room + 1).join('');
    return [
      `${c.accent(glyph.active)}  ${c.bold(title)}`,
      state.error ? `${c.yellow(glyph.bar)}  ${c.yellow(state.error)}` : `${c.accent(glyph.bar)}  ${c.dim(complete ? 'tab completes folders · esc back' : 'esc back')}`,
      `${c.accent(glyph.end)}  ${fit(shown, width - 4)}`,
    ];
  },
  showCursor: true,
  transient: () => transient,
  summary: (state) => step(summaryTitle, summaryValue(state.value)),
});

// ---- confirm ------------------------------------------------------------------------------------------------

export const confirmPrompt = ({title, detail = [], initial = true}) => ({
  init: () => ({value: initial}),
  key(state, key) {
    if (key.ch === 'y' || key.ch === 'Y') return {value: true, done: true};
    if (key.ch === 'n' || key.ch === 'N') return {value: false, done: false};
    if (['left', 'right', 'tab', 'up', 'down'].includes(key.name)) return {value: !state.value};
    if (key.name === 'enter') return {...state, done: state.value};
    if (key.name === 'escape') return {...state, back: true};
    return state;
  },
  view(state, width) {
    const choice = (on, text) => on ? c.accent(glyph.pointer) + ' ' + c.bold(text) : '  ' + c.dim(text);
    return [`${c.accent(glyph.active)}  ${c.bold(title)}`,
      ...detail.map(d => `${c.accent(glyph.bar)}  ${fit(d, width - 4)}`),
      `${c.accent(glyph.end)}  ${choice(state.value, 'Yes')}   ${choice(!state.value, 'No')}`];
  },
  summary: (state) => step(title, state.value ? 'Yes' : 'No'),
});

// ---- directory browser --------------------------------------------------------------------------------------

const skipped = new Set(['node_modules', '__pycache__']);
export function listDirectories(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name.startsWith('.') || skipped.has(entry.name)) continue;
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) try { isDir = fs.statSync(path.join(dir, entry.name)).isDirectory(); } catch { isDir = false; }
    if (isDir) out.push(entry.name);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base', numeric: true}));
}
const isVault = dir => { try { return fs.statSync(path.join(dir, '.obsidian')).isDirectory(); } catch { return false; } };

/**
 * Folder picker. Typing filters the folders, enter or → opens one, ← or backspace on an empty filter goes up,
 * and the two action rows choose the current folder or a new folder inside it (created later, on install).
 */
export const browsePrompt = ({title, start, newFolderName = 'Agent Notes', allowNew = true, read = listDirectories, vault = isVault, rows = 10}) => {
  const load = (dir, from) => {
    let names, error = '';
    try { names = read(dir); } catch (e) { names = []; error = e.code === 'EACCES' ? 'cannot read this folder' : e.message; }
    // Land on the first subfolder (or the one we came up from) so repeated enter keeps drilling down;
    // choosing is a deliberate move to the action rows above.
    const actions = allowNew ? 2 : 1;
    const cursor = !names.length ? 0 : from ? Math.max(0, names.indexOf(from)) + actions : actions;
    return {dir, names, vaultRoot: vault(dir), filter: '', cursor, error};
  };
  const items = state => {
    const f = state.filter.toLowerCase();
    const dirs = state.names.filter(n => n.toLowerCase().includes(f)).map(n => ({kind: 'dir', name: n}));
    return f ? dirs : [{kind: 'use'}, ...(allowNew ? [{kind: 'new'}] : []), ...dirs];
  };
  const up = state => { const parent = path.dirname(state.dir); return parent === state.dir ? state : load(parent, path.basename(state.dir)); };
  return {
    init: () => load(path.resolve(start)),
    key(state, key) {
      const list = items(state), item = list[state.cursor], n = list.length;
      if (key.name === 'up') return n ? {...state, cursor: (state.cursor - 1 + n) % n} : state;
      if (key.name === 'down') return n ? {...state, cursor: (state.cursor + 1) % n} : state;
      if (key.name === 'pageup' || key.name === 'home') return {...state, cursor: 0};
      if (key.name === 'pagedown' || key.name === 'end') return {...state, cursor: Math.max(0, n - 1)};
      if (key.name === 'left') return up(state);
      if (key.name === 'backspace') return state.filter ? {...state, filter: [...state.filter].slice(0, -1).join(''), cursor: 0} : up(state);
      if (key.name === 'escape') return state.filter ? {...state, filter: '', cursor: 0} : {...state, back: true};
      if (key.name === 'char' && key.ch !== '/') return {...state, filter: state.filter + key.ch, cursor: 0};
      if (key.name === 'char' && key.ch === '/') return item?.kind === 'dir' ? load(path.join(state.dir, item.name)) : state;
      if (!item) return state;
      if (key.name === 'right' || key.name === 'tab') return item.kind === 'dir' ? load(path.join(state.dir, item.name)) : state;
      if (key.name === 'enter') {
        if (item.kind === 'dir') return load(path.join(state.dir, item.name));
        if (item.kind === 'use') return {...state, done: state.dir};
        if (item.kind === 'new') return {...state, done: {newFolderIn: state.dir}};
      }
      return state;
    },
    view(state, width) {
      const list = items(state), visible = Math.min(rows, list.length);
      const top = Math.min(Math.max(0, state.cursor - visible + 1 + Math.min(2, list.length - 1 - state.cursor)), Math.max(0, list.length - visible));
      const where = displayPath(state.dir, width - 6 - (state.vaultRoot ? 18 : 0));
      const lines = [`${c.accent(glyph.active)}  ${c.bold(title)}`,
        `${c.accent(glyph.bar)}  ${c.accent(where)}${state.vaultRoot ? '  ' + c.dim(glyph.vault + ' Obsidian vault') : ''}`,
        `${c.accent(glyph.bar)}  ${state.filter ? c.dim('filter ') + state.filter + c.inverse(' ') : c.dim('type to filter')}`];
      if (state.error) lines.push(`${c.accent(glyph.bar)}  ${c.yellow(state.error)}`);
      if (!list.length) lines.push(`${c.accent(glyph.bar)}  ${c.dim(state.filter ? 'no folders match' : 'no subfolders')}`);
      for (let i = top; i < top + visible; i++) {
        const it = list[i], on = i === state.cursor;
        const text = it.kind === 'use' ? `${c.green(glyph.check)} Use this folder`
          : it.kind === 'new' ? `${c.accent('+')} New folder here ${c.dim('· ' + newFolderName + '…')}`
          : `${it.name}/`;
        lines.push(`${c.accent(glyph.bar)}  ${on ? c.accent(glyph.pointer) + ' ' + c.bold(text) : '  ' + text}`);
      }
      const more = list.length - visible;
      lines.push(`${c.accent(glyph.end)}  ${c.dim(`↑↓ move · enter open/choose · ← up · esc ${state.filter ? 'clear' : 'back'}${more > 0 ? ` · ${list.length} items` : ''}`)}`);
      return lines.map(l => fit(l, width));
    },
    transient: (state) => typeof state.done !== 'string',
    summary: (state) => step(title, state.done),
  };
};

// ---- runner -------------------------------------------------------------------------------------------------

/** Renders a prompt on a TTY and resolves with its result; throws Back on escape and Cancelled on ctrl-c. */
export function run(prompt, {input = process.stdin, output = process.stdout} = {}) {
  return new Promise((resolve, reject) => {
    let state = prompt.init(), drawn = 0;
    const width = () => Math.max(40, (output.columns || 80) - 1);
    const paint = lines => {
      let s = drawn ? `\x1b[${drawn - 1}A\r\x1b[J` : '';
      s += lines.map(l => fit(l, width())).join('\n');
      output.write(s);
      drawn = lines.length;
    };
    const finish = (fn, value, lines) => {
      input.off('data', onData); output.off('resize', onResize);
      input.setRawMode?.(false); input.pause();
      paint(lines); output.write((lines.length ? '\n' : '') + (prompt.showCursor ? '' : '\x1b[?25h'));
      fn(value);
    };
    const onData = data => {
      for (const key of parseKeys(data)) {
        if (key.name === 'ctrl-c') return finish(reject, new Cancelled(), [...prompt.view(state, width()).slice(0, 1), c.dim('   cancelled')]);
        state = prompt.key(state, key);
        if (state.back) return finish(reject, new Back(), []);
        // A step that only leads to another prompt (Browse…, Type a path…) leaves no line behind.
        if ('done' in state) return finish(resolve, state.done, prompt.transient?.(state) ? [] : [prompt.summary(state)(width())]);
      }
      paint(prompt.view(state, width()));
    };
    const onResize = () => { output.write(drawn ? `\x1b[${drawn - 1}A\r\x1b[J` : ''); drawn = 0; paint(prompt.view(state, width())); };
    if (!prompt.showCursor) output.write('\x1b[?25l');
    input.setRawMode?.(true); input.resume(); input.on('data', onData); output.on('resize', onResize);
    paint(prompt.view(state, width()));
  });
}

/** Restores the cursor if the process dies mid-prompt. */
process.on('exit', () => { if (process.stdout.isTTY) process.stdout.write('\x1b[?25h'); });
