// What agents may record and what they must leave out. Each kind has its own instructions in
// context/kinds/<id>.md, its own folder under the notes directory, and its own tag for dashboards.
// The installer renders only the kinds the user picked, so an agent never reads rules it does not need.

import {maxOwnStyle, styleById, styles, validateLanguage} from './styles.mjs';

export const kinds = [
  {id: 'tactical-direction', label: 'Tactical direction', folder: 'Tactical Direction', tag: 'tactical-direction',
    hint: 'your direction and pushback, verbatim',
    record: 'Every user disagreement or tactical direction, with the verbatim exchange and the final agreement', open: ['pending']},
  {id: 'pivots', label: 'Pivots', folder: 'Pivots', tag: 'pivot',
    hint: 'the approach changed, and what forced it',
    record: 'Each time the approach of record changes partway through the work', open: []},
  {id: 'challenges', label: 'Challenges & fixes', folder: 'Challenges', tag: 'challenge',
    hint: 'hard problems: root cause, fix, and why',
    record: 'A problem that took real effort to solve, with why the fix works', open: ['open', 'workaround']},
  {id: 'decisions', label: 'Decisions & tradeoffs', folder: 'Decisions', tag: 'decision',
    hint: 'calls the agent made, with alternatives',
    record: 'A choice between real alternatives that the agent made on its own judgment', open: ['proposed']},
  {id: 'dead-ends', label: 'Dead ends', folder: 'Dead Ends', tag: 'dead-end',
    hint: 'tried, abandoned, and why it failed',
    record: 'An approach that was tried for real and abandoned, with the conditions it failed under', open: ['revisit']},
  {id: 'gotchas', label: 'Gotchas & lessons', folder: 'Gotchas', tag: 'gotcha',
    hint: 'surprising tool or codebase behavior',
    record: 'Surprising behavior of a tool, library or this codebase that is worth remembering', open: []},
  {id: 'open-questions', label: 'Open questions & assumptions', folder: 'Open Questions', tag: 'open-question',
    hint: 'assumptions and undecided questions',
    record: 'An unconfirmed assumption or open question, from the moment work relies on it until it is settled', open: ['open']},
];

/** Picked when nothing was chosen before: the two kinds most projects want from day one. */
export const defaultRecord = ['pivots', 'challenges'];

export const exclusions = [
  {id: 'routine', label: 'Routine implementation steps', hint: 'what the diff or commit already shows', default: true,
    rule: 'Routine implementation steps: what the diff, the commit message or an implementation summary already records.'},
  {id: 'trivial-fixes', label: 'Trivial fixes', hint: 'typos, lint, formatting, first-try fixes', default: true,
    rule: 'Trivial fixes: typos, lint and formatting, and bugs with an obvious cause that were fixed on the first try.'},
  {id: 'agent-mechanics', label: 'Agent mechanics', hint: 'retries, tool errors, permission prompts', default: true,
    rule: 'Agent mechanics: retries, tool errors, permission prompts, reruns and other process noise that did not change the work.'},
  {id: 'personal', label: 'Personal details', hint: 'names, contacts, anything about people', default: true,
    rule: 'Personal details: names, contact details and anything about people rather than the work. Refer to people by role ("the reviewer").'},
  {id: 'brainstorm', label: 'Brainstorming not acted on', hint: 'ideas dropped without being tried', default: false,
    rule: 'Brainstorming not acted on: ideas floated and dropped without being tried.'},
  {id: 'restated-docs', label: 'What the repo already says', hint: 'facts the code, docs or README give', default: false,
    rule: 'What the repository already says: facts a reader can get from the code, its docs or its README.'},
];
export const defaultSkip = exclusions.filter(e => e.default).map(e => e.id);

export const kindById = id => kinds.find(k => k.id === id);
export const exclusionById = id => exclusions.find(e => e.id === id);

/** A user-defined kind's folder and tag come from its name, so they read naturally in the vault and in queries. */
export const folderFor = name => name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
export const tagFor = name => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';

/** Free text the user types ends up inside AGENTS.md and an HTML comment, so it must stay one inert line. */
export function validateText(value, what, max = 300) {
  if (!value.trim()) return `${what} must not be empty`;
  if (/[\r\n]/.test(value)) return `${what} must be a single line`;
  if (value.includes('-->') || value.includes('<!--')) return `${what} must not contain HTML comment markers`;
  if (value.length > max) return `${what} must be at most ${max} characters`;
  return '';
}

/** The sections a user-defined kind gets unless its author names its own. */
export const defaultCustomSections = ['Context', 'What happened', 'Why it matters', 'Follow-ups'];
export const maxDetails = 600;
/** Section names are typed as one comma-separated line; each one becomes a `## N. Name` heading in every note. */
export const parseSections = text => text.split(',').map(s => s.trim()).filter(Boolean);
export function validateSections(sections, what = 'a section name') {
  if (!sections.length) return 'name at least one section';
  if (sections.length > 10) return 'use at most 10 sections';
  for (const s of sections) {
    const error = validateText(s, what, 60);
    if (error) return error;
    if (/[`#]/.test(s)) return `${what} must not contain backticks or #`;
  }
  const lower = sections.map(s => s.toLowerCase());
  const dup = sections.find((s, i) => lower.indexOf(s.toLowerCase()) !== i);
  return dup ? `section "${dup}" is listed twice` : '';
}

/** Why a user-defined kind cannot be stored, or '' when it can. */
export function validateCustomKind(k) {
  for (const [value, what] of [[k.name, 'a note kind name'], [k.when, `when to record "${k.name}"`]]) {
    const error = validateText(value ?? '', what);
    if (error) return error;
  }
  if (!folderFor(k.name)) return `note kind name "${k.name}" has no usable characters for a folder`;
  if (k.sections !== undefined) {
    if (!Array.isArray(k.sections)) return `the sections of "${k.name}" must be a list`;
    const error = validateSections(k.sections, `a section of "${k.name}"`);
    if (error) return error;
  }
  if (k.details !== undefined) {
    const error = validateText(k.details ?? '', `how to write "${k.name}"`, maxDetails);
    if (error) return error;
  }
  return '';
}
/**
 * A user-defined kind as stored and rendered: its name and "record it when" sentence, plus, only when its author
 * changed them, the note's sections and how to write it. Leaving the defaults out keeps older installs byte-identical.
 */
function cleanCustomKind(k) {
  const sections = k.sections?.map(s => s.trim());
  const same = sections && sections.length === defaultCustomSections.length && sections.every((s, i) => s === defaultCustomSections[i]);
  return {name: k.name.trim(), when: k.when.trim(), ...(sections && !same ? {sections} : {}), ...(k.details?.trim() ? {details: k.details.trim()} : {})};
}

/**
 * A complete, validated selection. Unknown ids are an error rather than silently dropped: a typo in --record
 * would otherwise install instructions that record nothing the user asked for.
 */
export function normalizeSelection({record = defaultRecord, skip = defaultSkip, customKinds = [], customSkips = [], folders = {}, styles: styleIds = [], ownStyle = '', language = ''} = {}) {
  const badKind = record.filter(id => !kindById(id));
  if (badKind.length) throw new Error(`unknown note kind ${badKind.join(', ')}; choose from ${kinds.map(k => k.id).join(', ')}`);
  const badSkip = skip.filter(id => !exclusionById(id));
  if (badSkip.length) throw new Error(`unknown exclusion ${badSkip.join(', ')}; choose from ${exclusions.map(e => e.id).join(', ')}`);
  for (const k of customKinds) { const error = validateCustomKind(k); if (error) throw new Error(error); }
  for (const s of customSkips) { const error = validateText(s, 'an exclusion'); if (error) throw new Error(error); }
  const names = [...kinds.filter(k => record.includes(k.id)).map(k => k.label.toLowerCase()), ...customKinds.map(k => k.name.trim().toLowerCase())];
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`note kind "${dup}" is listed twice`);
  if (!names.length) throw new Error('choose at least one kind of note to record');
  const badStyle = styleIds.filter(id => !styleById(id));
  if (badStyle.length) throw new Error(`unknown style ${badStyle.join(', ')}; choose from ${styles.map(st => st.id).join(', ')}`);
  if (ownStyle.trim()) { const error = validateText(ownStyle, 'your own style', maxOwnStyle); if (error) throw new Error(error); }
  if (language.trim()) { const error = validateLanguage(language); if (error) throw new Error(error); }
  // Catalog order, not click order, so the same choice always renders the same bytes.
  return {
    record: kinds.filter(k => record.includes(k.id)).map(k => k.id),
    skip: exclusions.filter(e => skip.includes(e.id)).map(e => e.id),
    customKinds: customKinds.map(cleanCustomKind),
    customSkips: [...new Set(customSkips.map(s => s.trim()))],
    folders: Object.fromEntries(Object.entries(folders).filter(([id]) => record.includes(id))),
    styles: styles.filter(st => styleIds.includes(st.id)).map(st => st.id),
    ownStyle: ownStyle.trim(),
    language: language.trim(),
  };
}

/** Every kind the selection records, built-in first, each with the folder and tag the notes will use. */
export function selectedKinds(selection) {
  return [
    ...selection.record.map(id => ({...kindById(id), folder: selection.folders[id] ?? kindById(id).folder, custom: false})),
    ...selection.customKinds.map(k => ({id: tagFor(k.name), label: k.name, when: k.when, sections: k.sections ?? defaultCustomSections, details: k.details,
      folder: folderFor(k.name), tag: tagFor(k.name), open: [], custom: true})),
  ];
}
