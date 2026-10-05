#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const begin = '<!-- BEGIN tactical-direction-context -->';
const end = '<!-- END tactical-direction-context -->';
const args = process.argv.slice(2);
const options = {project: process.cwd(), 'notes-dir': 'Tactical Direction'};
let check = false;
try {
  for (let i=0; i<args.length; i++) {
    const arg=args[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: auto-note-taker [--project PATH] [--notes-dir PATH] [--check]\nInstalls or updates one managed block in AGENTS.md. --check reports drift without writing.');
      process.exit(0);
    }
    if (arg === '--check') { check=true; continue; }
    if (!['--project','--notes-dir'].includes(arg) || !args[i+1] || args[i+1].startsWith('--')) throw new Error(`Invalid argument: ${arg}`);
    options[arg.slice(2)]=args[++i];
  }
  if (/[\r\n`]/.test(options['notes-dir']) || !options['notes-dir'].trim()) throw new Error('notes-dir must be a nonempty, single-line path without backticks');
  const root=await fs.realpath(path.resolve(options.project));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('project must be an existing directory');
  const agents=path.join(root,'AGENTS.md');
  // Preserve a project's AGENTS.md -> CLAUDE.md convention. Refuse external targets.
  let target=agents, prior='';
  try {
    target=await fs.realpath(agents);
    const relative=path.relative(root,target);
    if (relative.startsWith('..'+path.sep) || relative==='..' || path.isAbsolute(relative)) throw new Error('AGENTS.md points outside the project; install in its owning project instead');
    if (!(await fs.stat(target)).isFile()) throw new Error('AGENTS.md must be a regular file or internal symlink');
    prior=await fs.readFile(target,'utf8');
  } catch(error) {
    if(error.code!=='ENOENT') throw error;
    // A dangling symlink is not a missing instructions file.
    try { await fs.lstat(agents); throw new Error('AGENTS.md is a dangling symlink'); }
    catch(e) { if(e.code!=='ENOENT') throw e; }
  }
  const template=await fs.readFile(fileURLToPath(new URL('../context/AGENTS.md',import.meta.url)),'utf8');
  const block=begin+'\n'+template.replaceAll('{{notes_dir}}',()=>options['notes-dir']).trimEnd()+'\n'+end;
  const starts=prior.split(begin).length-1, ends=prior.split(end).length-1;
  if(starts!==ends || starts>1 || (starts===1 && prior.indexOf(end)<prior.indexOf(begin))) throw new Error('Malformed or duplicate managed block; no changes made');
  const next=starts ? prior.slice(0,prior.indexOf(begin))+block+prior.slice(prior.indexOf(end)+end.length)
    : prior+(prior ? (prior.endsWith('\n\n')?'':prior.endsWith('\n')?'\n':'\n\n') : '')+block+'\n';
  if(check) {
    console.log(next===prior?'Context is current.':'Context is missing or out of date.');
    process.exitCode=next===prior?0:1;
  } else if(next===prior) console.log(`Already installed: ${target}`);
  else {
    // Do not overwrite an edit that landed while the installer was reading its template.
    const current=await fs.readFile(target,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
    if(current!==prior) throw new Error('Project instructions changed during installation; retry');
    const temporary=target+'.tactical-direction-'+process.pid;
    const mode=await fs.stat(target).then(s=>s.mode & 0o777).catch(()=>0o644);
    await fs.writeFile(temporary,next,{flag:'wx',mode});
    try { await fs.rename(temporary,target); }
    finally { await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;}); }
    console.log(`Installed: ${target}\nTactical notes: ${options['notes-dir']}`);
  }
} catch(error) {
  console.error(`auto-note-taker: ${error.message}`);
  process.exitCode=1;
}
