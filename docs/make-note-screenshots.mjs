#!/usr/bin/env node
// Regenerates docs/images/note-*.png: builds a throwaway vault from docs/demo-notes, installs the styling snippet
// and dashboard with the real installer, opens it in an isolated Obsidian (its own user data, so your vaults and
// settings are untouched), and captures each shot over the DevTools protocol. macOS, Obsidian 1.9+, Node 22+.
//
//   node docs/make-note-screenshots.mjs
//
// OBSIDIAN overrides the app binary; KEEP=1 leaves the vault and Obsidian running for a closer look.
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const images = path.join(repo, 'docs/images');
const app = process.env.OBSIDIAN ?? '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const port = 9334;
const note = 'Projects/storefront/Tactical Direction/webhook/delivery/retryPolicy.md';
const pending = 'Projects/storefront/Tactical Direction/uploader/s3/multipartTuning.md';
const shots = [
  {name: 'note-agreed', file: note, width: 1000, height: 800},
  {name: 'note-banner', file: note, at: '# ', width: 1000, height: 400},
  {name: 'note-pending', file: pending, width: 1000, height: 760},
  {name: 'note-exchange', file: note, at: '### Exchange (verbatim)', width: 1000, height: 820},
  {name: 'note-reconciliation', file: note, at: '## 4. Reconciliation', width: 1000, height: 760},
  {name: 'note-final', file: note, at: '## 5. Final agreement', width: 1000, height: 760},
  {name: 'note-dashboard', file: 'Projects/storefront/Agent Notes.base', view: 'Tactical direction', width: 1440, height: 390},
];

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-note-taker-shots-'));
const vault = path.join(work, 'Notes'), project = path.join(work, 'storefront'), userData = path.join(work, 'obsidian');
const notes = path.join(vault, 'Projects/storefront');

// A vault that looks lived in, so the breadcrumb and file tree read like a real one.
for (const dir of ['.obsidian', 'Journal', 'Reading', 'Projects/billing-worker']) await fs.mkdir(path.join(vault, dir), {recursive: true});
await fs.cp(path.join(repo, 'docs/demo-notes'), notes, {recursive: true});
await fs.writeFile(path.join(vault, '.obsidian/appearance.json'), JSON.stringify({theme: 'obsidian'}, null, 2));
await fs.mkdir(project);
await fs.writeFile(path.join(project, 'AGENTS.md'), '# storefront\n');
const install = spawnSync(process.execPath, [path.join(repo, 'bin/install.mjs'), '--project', project, '--notes-dir', notes,
  '--record', 'tactical-direction', '--obsidian-extras', '--yes'], {encoding: 'utf8'});
if (install.status !== 0) throw new Error(install.stderr || install.stdout);

await fs.mkdir(userData);
await fs.writeFile(path.join(userData, 'obsidian.json'), JSON.stringify({vaults: {a0b1c2d3e4f5a6b7: {path: vault, ts: Date.now(), open: true}}}));
const obsidian = spawn(app, [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {stdio: 'ignore'});

const sleep = ms => new Promise(r => setTimeout(r, ms));
let page;
for (let i = 0; i < 60 && !page; i++) {
  await sleep(500);
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.type === 'page' && !p.url.includes('starter')); } catch {}
}
if (!page) throw new Error('Obsidian did not open its DevTools port');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const waiting = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); waiting.delete(m.id); };
const send = (method, params = {}) => new Promise(r => { waiting.set(++id, r); ws.send(JSON.stringify({id, method, params})); });
async function evaluate(body, arg) {
  const r = await send('Runtime.evaluate', {expression: `(async (arg) => { ${body} })(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true});
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluation failed');
  return r.result?.result?.value;
}

for (let i = 0; i < 60 && !(await evaluate('return !!window.app?.workspace?.layoutReady && !!app.vault.getAbstractFileByPath(arg)', note)); i++) await sleep(500);
// Snippets load on startup; make sure the installer's one is on before the first shot.
await evaluate(`app.customCss.setCssEnabledStatus('tactical-direction', true); await app.customCss.readSnippets?.();`);
await evaluate(`app.workspace.leftSplit?.collapse(); app.workspace.rightSplit?.collapse();
  // The status bar floats over the bottom-right corner of every shot.
  document.head.append(Object.assign(document.createElement('style'), {textContent: '.status-bar { display: none; }'}));`);

for (const shot of shots) {
  await send('Emulation.setDeviceMetricsOverride', {width: shot.width, height: shot.height, deviceScaleFactor: 2, mobile: false});
  await evaluate(`
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(app.vault.getAbstractFileByPath(arg.file), {state: {mode: 'preview'}, active: true});
    await new Promise(r => setTimeout(r, 800));
    if (arg.view) {
      const base = leaf.view.controller ?? leaf.view;
      await (base.selectView?.(arg.view) ?? leaf.setEphemeralState({subpath: '#' + arg.view}));
    }
    const preview = leaf.view.previewMode;
    if (preview) {
      const lines = (await app.vault.cachedRead(leaf.view.file)).split('\\n');
      const line = arg.at ? lines.findIndex(l => l.startsWith(arg.at)) : 0;
      preview.applyScroll(Math.max(0, line));
    }
  `, shot);
  await sleep(1200);
  // Reading view renders lazily; scroll once more after it settled, then nudge the heading below the header.
  if (shot.at) await evaluate(`
    const scroller = app.workspace.getLeaf(false).view.containerEl.querySelector('.markdown-preview-view');
    const [, hashes, text] = arg.at.match(/^(#+) (.*)$/);
    const heading = [...scroller.querySelectorAll('h' + hashes.length)].find(h => h.textContent.trim().startsWith(text));
    if (heading) scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
  `, shot);
  await sleep(500);
  const r = await send('Page.captureScreenshot', {format: 'png'});
  await fs.writeFile(path.join(images, shot.name + '.png'), Buffer.from(r.result.data, 'base64'));
  console.log(`${shot.name} ${shot.width}x${shot.height}`);
}

ws.close();
if (process.env.KEEP) { obsidian.unref(); console.log(`kept ${work}`); }
else { obsidian.kill(); await sleep(500); await fs.rm(work, {recursive: true, force: true}); }
