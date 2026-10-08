// Checks a note's prose against the writing rules a script can check: the Simplified Technical English
// (ASD-STE100) rules, ported from implementation-summary's ste_check.py, plus the few the other styles add.
// It reads Markdown notes and skips what is not the note's own prose: front matter, headings, code, tables,
// callout titles and verbatim quote callouts. Warnings are questions, not errors: it cannot judge meaning.

/** Inline code, links to notes and URLs become this one word: a technical name, never a style problem. */
export const CODE = 'CODE';

const set = text => new Set(text.trim().split(/\s+/));
const IMPERATIVES = set(`
add answer ask attach avoid build call change check choose click close copy create delete do don't edit end enter
find fix follow give install keep let link list make mark move name never open pass pick prefer press print put read
record register reload remove rerun replace restart return run save see select send set show skip start stop take
tell treat try type use wait write`);
const CONDITIONS = ['if ', 'when ', 'before ', 'after ', 'once ', 'unless ', 'until '];
const PARTICIPLES = set(`
made done built sent kept held shown written given taken found left lost known seen told thrown chosen broken spent
set put cut bound brought bought caught taught thought sold paid laid led fed met won driven hidden forgotten gotten
begun drawn grown worn torn frozen spoken stolen beaten eaten fallen shaken mistaken forbidden overwritten rewritten
rebuilt split shut spread stuck struck hung dealt felt heard meant sought swept wound understood withheld upheld run rerun`);
const NOT_PARTICIPLES = set('need needed speed feed seed bed red shed bleed breed embed proceed exceed succeed indeed weed deed reed creed greed');
const ING_OK = set(`
thing things something nothing anything everything string strings during morning evening ceiling sibling siblings
warning warnings heading headings setting settings binding bindings mapping mappings padding spring bring sting
swing wing wings king ring rings sing ping ding wring meaning meanings
logging routing caching hashing polling scheduling rendering staging`);
const PHRASAL = {
  'set up': 'start, create or prepare', 'carry out': 'do', 'find out': 'find or learn', 'look into': 'examine',
  'figure out': 'find', 'point out': 'show or tell', 'end up': 'become or stop', 'come up with': 'make or find',
  'go through': 'examine or read', 'fill in': 'complete', 'fill out': 'complete', 'pick up': 'get or take',
  'turn on': 'start', 'turn off': 'stop', 'take out': 'remove', 'put in': 'add', 'clean up': 'remove or clean',
  'run into': 'find or get', 'give up': 'stop',
};
/** Long or vague words and the shorter word STE uses instead. */
export const steWords = {
  utilize: 'use', utilise: 'use', utilization: 'use', leverage: 'use', facilitate: 'help',
  numerous: 'many', approximately: 'about', commence: 'start', terminate: 'stop or end',
  sufficient: 'enough', 'prior to': 'before', 'in order to': 'to', subsequently: 'then or after',
  additional: 'more', obtain: 'get', ensure: 'make sure', ensures: 'makes sure', perform: 'do',
  performs: 'does', via: 'through or with', 'e.g.': 'for example', 'i.e.': 'that is',
  'etc.': 'the items themselves', respectively: 'each pair, stated', aforementioned: 'this',
  therefore: 'so', however: 'but', whereas: 'but', thereby: 'so', 'in the event that': 'if',
  'a number of': 'some or many', 'with regard to': 'about', regarding: 'about', demonstrate: 'show',
  demonstrates: 'shows', indicate: 'show', indicates: 'shows', initiate: 'start', initiates: 'starts',
  modify: 'change', modifies: 'changes',
};
const ABBREVIATIONS = {'e.g.': 'eg_', 'i.e.': 'ie_', 'etc.': 'etc_', 'vs.': 'vs_', 'approx.': 'approx_'};
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every rule this checker knows, with what its warning asks for. */
export const ruleCatalog = {
  length: 'a descriptive sentence or an instruction over the word limit',
  passive: 'a form of "be" with a past participle ("is sent", "were removed")',
  tense: 'a perfect tense ("has been", "had sent")',
  hedge: '"would", "might", "should" or "could" in a statement',
  ing: 'an "-ing" word that is not a known noun or technical name',
  phrasal: 'a phrasal verb from a short list ("set up", "carry out")',
  word: 'a word from the style\'s list, with its replacement',
  semicolon: 'a semicolon between two clauses',
  instructions: 'an instruction with two actions ("Run X, then open Y")',
  paragraph: 'a paragraph over the sentence limit',
  future: '"will" with a verb, where the present tense says the same',
  banner: 'a note whose first block after the title is not the banner callout',
};

/** The full ASD-STE100 check: its ten rules, 25 words for a description, 20 for an instruction, six sentences a paragraph. */
export const steConfig = {rules: Object.keys(ruleCatalog).filter(r => r !== 'future' && r !== 'banner'), limits: {descriptive: 25, instruction: 20, paragraph: 6}, words: steWords};

/** One line of Markdown with code, links, URLs, tags and emphasis made plain. */
export function clean(text) {
  return text
    .replace(/`+[^`]*`+/g, CODE)
    .replace(/\[\[[^\]]*\]\]/g, CODE)
    .replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>|https?:\/\/\S+/g, 'URL')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)/g, '')
    .replace(/[ \t]+/g, ' ').trim();
}

/**
 * [first line, text] for each paragraph and list item of a note. Skips front matter, code, headings, tables, HTML
 * blocks, callout titles, every line of a `quote` callout (a verbatim message is never the note's own prose) and
 * text between <!-- ste: off --> and <!-- ste: on -->.
 */
export function markdownUnits(text) {
  const units = [];
  let cur = [], start = 0, fence = null, off = false, quote = false;
  const flush = () => { if (cur.length) units.push([start, cur.join('\n')]); cur = []; };
  const lines = text.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (close > 0) i = close + 1;
  }
  for (; i < lines.length; i++) {
    const number = i + 1;
    let line = lines[i].trim();
    const marker = line.match(/^<!--\s*ste:\s*(off|on)\s*-->$/);
    if (marker) { flush(); off = marker[1] === 'off'; continue; }
    if (off) continue;
    const opens = line.match(/^(`{3,}|~{3,})/);
    if (fence) { if (opens && line.startsWith(fence)) fence = null; continue; }
    if (opens) { flush(); fence = opens[1]; continue; }
    const quoted = /^>/.test(line);
    if (!quoted) quote = false;
    if (quoted) {
      line = line.replace(/^(>\s?)+/, '').trim();
      const callout = line.match(/^\[!([\w-]+)[^\]]*\][-+]?/);
      if (callout) { flush(); quote = callout[1].toLowerCase() === 'quote'; continue; }
      if (quote) continue;
      const nested = line.match(/^(`{3,}|~{3,})/);
      if (nested) { flush(); fence = nested[1]; continue; }
    }
    if (!line || /^(#|\||<|---)/.test(line)) { flush(); continue; }
    const item = line.match(/^([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (item) {
      flush();
      start = number;
      cur = [item[2].replace(/^\*\*[^*]{1,30}\*\*\s*:\s*/, '')];  // a label: **Risk**:
      continue;
    }
    if (!cur.length) start = number;
    cur.push(line);
  }
  flush();
  return units.map(([n, t]) => [n, clean(t)]).filter(([, t]) => t);
}

export const words = sentence => sentence.match(/[A-Za-z0-9][\w'’/.-]*[A-Za-z0-9]|[A-Za-z0-9]/g) ?? [];

/** [line offset, sentence] inside one paragraph; captions and labels under three words are not sentences. */
export function sentences(unit) {
  let protectedText = unit;
  for (const [abbr, mark] of Object.entries(ABBREVIATIONS)) protectedText = protectedText.replace(new RegExp(escape(abbr), 'gi'), mark);
  const out = [];
  let pos = 0;
  for (const m of protectedText.matchAll(new RegExp(`(?<=[.!?])["')\\]]?\\s+(?=[A-Z0-9"'(\\[\`]|${CODE})`, 'g'))) {
    out.push([protectedText.slice(0, pos).split('\n').length - 1, protectedText.slice(pos, m.index).trim()]);
    pos = m.index + m[0].length;
  }
  out.push([protectedText.slice(0, pos).split('\n').length - 1, protectedText.slice(pos).trim()]);
  return out.map(([offset, s]) => {
    for (const [abbr, mark] of Object.entries(ABBREVIATIONS)) s = s.replaceAll(mark, abbr);
    return [offset, s.replace(/\s+/g, ' ')];
  }).filter(([, s]) => words(s).length >= 3);
}

export function isInstruction(sentence) {
  let s = sentence.toLowerCase();
  if (CONDITIONS.some(c => s.startsWith(c)) && s.includes(',')) s = s.slice(s.indexOf(',') + 1).trim();
  const first = s.match(/^[a-z']+/);
  return Boolean(first) && (IMPERATIVES.has(first[0]) || s.startsWith('do not'));
}

const participles = [...PARTICIPLES].sort().join('|');
const passive = /\b(am|is|are|was|were|be|been|being|gets?|got)\s+(?:(?:not|never|also|only|now|still|already|always|then|all|both|\w+ly)\s+)?([a-z]+)\b/g;
const perfect = new RegExp(`\\b(has|have|had|having)\\s+(?:(?:not|never|already|also|just|since)\\s+)?(been|[a-z]+ed|${participles})\\b`);
const twoActions = new RegExp(`(,\\s*|\\s)(then|and then)\\s+[a-z]|\\band\\s+(${[...IMPERATIVES].sort().join('|')})\\b`);

/** [rule, detail] for each rule one sentence breaks, under `config`. */
export function checkSentence(s, config = steConfig) {
  const on = new Set(config.rules), found = [];
  const n = words(s).length, instruction = isInstruction(s);
  const limit = instruction ? config.limits.instruction : config.limits.descriptive;
  if (on.has('length') && n > limit) found.push(['length', `${n} words (max ${limit} for ${instruction ? 'an instruction' : 'a description'})`]);
  // A quoted word is a mention ("use", not "utilize"), not a use: only the length rule counts it.
  const plain = s.replaceAll(CODE, ' ').replace(/"[^"]*"|“[^”]*”/g, ' '), low = plain.toLowerCase();
  if (on.has('passive')) for (const m of low.matchAll(passive)) {
    const w = m[2];
    if (PARTICIPLES.has(w) || (w.endsWith('ed') && w.length > 4 && !NOT_PARTICIPLES.has(w))) {
      found.push(['passive', `"${m[0]}": name who does it, in the active voice`]);
      break;
    }
  }
  const tense = low.match(perfect);
  if (on.has('tense') && tense && !NOT_PARTICIPLES.has(tense[2])) found.push(['tense', `"${tense[0]}": use a simple tense`]);
  const hedge = low.match(/\b(would|might|should|could)\b/);
  if (on.has('hedge') && hedge) found.push(['hedge', `"${hedge[1]}": state the fact or the rule with a direct verb (can, must, do)`]);
  if (on.has('ing')) for (const m of plain.matchAll(/(?<![\w`/.-])([A-Za-z]+ing)s?\b/g)) {
    const w = m[1];
    if (ING_OK.has(w.toLowerCase()) || w.length <= 5 || (w[0] !== w[0].toLowerCase() && m.index > 0)) continue;
    found.push(['ing', `"${w}": use a verb or a noun, not an -ing form (keep it if it is a technical name)`]);
    break;
  }
  if (on.has('phrasal')) for (const [phrase, alt] of Object.entries(PHRASAL)) {
    if (new RegExp(`\\b${phrase.replace(' ', '\\s+')}\\b`).test(low)) { found.push(['phrasal', `"${phrase}": use ${alt}`]); break; }
  }
  if (on.has('word')) for (const [word, alt] of Object.entries(config.words ?? {}))
    if (new RegExp(`(?<![\\w-])${escape(word)}(?![\\w-])`).test(low)) found.push(['word', `"${word}": use ${alt}`]);
  const future = low.match(/\bwill\s+(?:not\s+)?[a-z]+/);
  if (on.has('future') && future) found.push(['future', `"${future[0]}": use the present tense`]);
  if (on.has('semicolon') && plain.includes(';')) found.push(['semicolon', 'split the sentence at the semicolon']);
  if (on.has('instructions') && instruction && twoActions.test(low)) found.push(['instructions', 'give one instruction in each sentence']);
  return found;
}

/**
 * The line of a note's title when the first block after it is not a banner callout with text, else 0. BLUF puts
 * the bottom line first, and in a note the banner is that place.
 */
export function missingBanner(text) {
  const lines = text.split(/\r?\n/);
  const title = lines.findIndex(l => /^# /.test(l));
  if (title < 0) return 1;
  const next = lines.findIndex((l, i) => i > title && l.trim());
  if (next < 0 || !/^>\s*\[![\w-]+\|banner\]/.test(lines[next])) return title + 1;
  return /^>\s*\S/.test(lines[next + 1] ?? '') ? 0 : title + 1;
}

/** {sentences, warnings: [{rule, line, detail, sentence}]} for one note's Markdown. */
export function check(text, config = steConfig) {
  const report = {sentences: 0, warnings: []};
  const banner = config.rules.includes('banner') ? missingBanner(text) : 0;
  if (banner) report.warnings.push({rule: 'banner', line: banner, detail: 'open with the banner callout, and state the bottom line in its first sentence', sentence: ''});
  for (const [line, unit] of markdownUnits(text)) {
    const list = sentences(unit);
    report.sentences += list.length;
    if (config.rules.includes('paragraph') && list.length > config.limits.paragraph)
      report.warnings.push({rule: 'paragraph', line, detail: `${list.length} sentences (max ${config.limits.paragraph})`, sentence: list[0][1]});
    for (const [offset, s] of list)
      for (const [rule, detail] of checkSentence(s, config)) report.warnings.push({rule, line: line + offset, detail, sentence: s});
  }
  return report;
}

const snippet = (s, n = 90) => { s = s.replaceAll(CODE, '`…`'); return s.length <= n ? s : s.slice(0, n - 1) + '…'; };

/** Readable warning lines for one checked file; `limit` caps how many warnings are listed. */
export function reportLines(report, label, limit = Infinity) {
  const count = report.warnings.length;
  if (!count) return [`${label}: no warnings in ${report.sentences} sentences`];
  return [`${label}: ${count} warning${count === 1 ? '' : 's'} in ${report.sentences} sentences`,
    ...report.warnings.slice(0, limit).map(w => `  L${w.line} ${w.rule}: ${w.detail} - "${snippet(w.sentence)}"`),
    ...(count > limit ? [`  … ${count - limit} more`] : [])];
}
