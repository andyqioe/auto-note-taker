// How a note's own prose reads, beyond the shared rules: writing standards the user can pick at install, each with
// its rules in context/styles/<id>.md, the subset of those rules `lint` can check, and an example for the wizard.
// The examples all restate one fact, so the options compare side by side. Choosing no style keeps a block
// byte-identical to installs from before styles existed.

import {steConfig, steWords} from './ste.mjs';

const pick = (list, keys) => Object.fromEntries(keys.map(k => [k, list[k]]));

export const styles = [
  {id: 'ste', label: 'ASD-STE100', hint: 'Simplified Technical English: short, active, one word per meaning', english: true,
    example: 'The job lock now expires with the lease of the worker. A worker that crashes does not block its retries.',
    checks: steConfig},
  {id: 'plain', label: 'Plain language', hint: 'ISO 24495-1: everyday words, reader first', english: false,
    example: 'When a worker crashed, its lock stayed, so retries piled up. Now the lock ends when the worker\'s lease ends.',
    checks: {rules: ['length', 'passive', 'word', 'paragraph'], limits: {descriptive: 30, instruction: 30, paragraph: 6},
      words: pick(steWords, ['utilize', 'utilise', 'utilization', 'leverage', 'facilitate', 'numerous', 'approximately', 'commence',
        'terminate', 'sufficient', 'prior to', 'in order to', 'subsequently', 'obtain', 'aforementioned', 'in the event that',
        'with regard to', 'demonstrate', 'demonstrates', 'initiate', 'initiates'])}},
  {id: 'bluf', label: 'BLUF', hint: 'bottom line up front (Army AR 25-50)', english: false,
    example: 'Crashed workers no longer block retries. The lock outlived the worker, so it now expires with the lease.',
    checks: {rules: ['banner', 'paragraph'], limits: {paragraph: 6}, words: {}}},
  {id: 'google', label: 'Google developer style', hint: 'present tense, "you", code font, no Latin abbreviations', english: true,
    example: 'If a worker crashes, its retries now run, because the job lock expires with the worker\'s lease.',
    checks: {rules: ['future', 'passive', 'word'], limits: {}, words: {
      please: 'leave it out', simply: 'leave it out', easily: 'leave it out', obviously: 'leave it out',
      'e.g.': 'for example', 'i.e.': 'that is', 'etc.': 'the items themselves', 'and/or': '"and" or "or"', utilize: 'use'}}},
];

/** How notes read with no style chosen, shown above the styles so the difference is visible. */
export const unstyledExample = 'Retries were piling up because the lock outlived the worker; it now expires with the worker\'s lease.';

export const styleById = id => styles.find(s => s.id === id);
export const maxOwnStyle = 600;
export const maxLanguage = 40;

/** Why a language name cannot be stored, or '' when it can: one name, such as "English" or "Português (Brasil)". */
export function validateLanguage(value) {
  if (!value.trim()) return 'name a language';
  if (value.length > maxLanguage) return `a language name must be at most ${maxLanguage} characters`;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} ()'-]*$/u.test(value.trim())) return 'a language name uses letters, spaces, hyphens and parentheses only';
  return '';
}

/**
 * What `lint` checks for these styles: every rule any of them checks, the strictest limit where two set one, and
 * all their word lists. null when no chosen style has a rule a script can check.
 */
export function lintConfig(ids) {
  const chosen = ids.map(styleById).filter(Boolean).map(s => s.checks);
  const rules = [...new Set(chosen.flatMap(c => c.rules))];
  if (!rules.length) return null;
  const limits = {};
  for (const c of chosen) for (const [key, value] of Object.entries(c.limits)) limits[key] = Math.min(limits[key] ?? Infinity, value);
  return {rules, limits: {descriptive: Infinity, instruction: Infinity, paragraph: Infinity, ...limits}, words: Object.assign({}, ...chosen.map(c => c.words))};
}
