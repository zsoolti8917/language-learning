// Pruning rules and trigger detection of the text analyzer. Pure: no ports, no SQL.
// Every rule narrows the readings of a word and never removes the last one.
import type {
  Case,
  Gender,
  GrammaticalNumber,
  Pos,
  ReadingMethod,
  TriggerKind,
} from '@app/contracts';
import type { TriggerFacts } from './repo';

/** One candidate reading of a word: a lemma and one of its form's tags. */
export interface Option {
  lemmaId: number;
  lemma: string;
  pos: Pos;
  /** The form as the dataset writes it. */
  form: string;
  /** Undefined for the empty tag (prepositions, adverbs...). */
  tag?: string;
  case?: Case;
  number?: GrammaticalNumber;
  gender?: Gender;
  /** True for an adjective, pronoun or numeral reading with gender that agrees with a noun. */
  agrees: boolean;
}

export interface Trig {
  i?: number;
  kind: TriggerKind;
  id?: string;
}

/** A word token while it is analysed. */
export interface Word {
  /** The readings still possible, the most frequent first. */
  options: Option[];
  /** How many readings the dictionary gave. */
  initial: number;
  method?: ReadingMethod;
  trig?: Trig;
}

/** One sentence while it is analysed. `words[i]` belongs to `tokens[i]` (null for others). */
export interface WorkSentence {
  s: number;
  e: number;
  tokens: { s: number; e: number; t: 'word' | 'num' | 'punct' }[];
  /** The text of each token (NFC). */
  texts: string[];
  words: (Word | null)[];
}

/** The trigger list, indexed by the lemma of the trigger word. */
export interface TriggerIndex {
  preposition: Map<number, TriggerFacts[]>;
  numeral: Map<number, TriggerFacts[]>;
  verb: Map<number, TriggerFacts[]>;
}

export function indexTriggers(rows: readonly TriggerFacts[]): TriggerIndex {
  const out: TriggerIndex = { preposition: new Map(), numeral: new Map(), verb: new Map() };
  for (const r of rows) {
    if (r.lemmaId === null) continue;
    const map =
      r.kind === 'preposition'
        ? out.preposition
        : r.kind === 'numeral'
          ? out.numeral
          : r.kind === 'verb'
            ? out.verb
            : undefined;
    if (!map) continue;
    const list = map.get(r.lemmaId) ?? [];
    list.push(r);
    map.set(r.lemmaId, list);
  }
  return out;
}

/** A phrase governed by a trigger word: the tokens whose case it decides. */
export interface Phrase {
  /** Index of the trigger token in the sentence. */
  trigger: number;
  kind: 'preposition' | 'numeral';
  members: number[];
  /** The case the trigger asks for, for a numeral; prepositions look it up per member. */
  triggers: TriggerFacts[];
}

const NOMINAL_POS: ReadonlySet<Pos> = new Set(['noun', 'adj', 'pron', 'num']);
const isNominal = (o: Option) => o.case !== undefined && NOMINAL_POS.has(o.pos);
const NUMERAL_FROM = 5;

/** Keeps the readings that pass `keep`, unless none would be left. Returns true on a change. */
export function narrow(w: Word, keep: (o: Option) => boolean): boolean {
  const kept = w.options.filter(keep);
  if (kept.length === 0 || kept.length === w.options.length) return false;
  w.options = kept;
  return true;
}

/**
 * Walks the noun phrase that starts at token `start`: modifiers, then the head. Numbers and
 * adverbs inside are passed over. Each member is narrowed to nominal readings that `allowed`
 * accepts. Stops after the head (a word with no agreeing reading) or at anything else.
 */
function walkPhrase(s: WorkSentence, start: number, allowed: (o: Option) => boolean): number[] {
  const members: number[] = [];
  for (let j = start; j < s.tokens.length; j++) {
    const tok = s.tokens[j];
    if (!tok || tok.t === 'punct') break;
    if (tok.t === 'num') continue;
    const w = s.words[j];
    if (!w || w.options.length === 0) break;
    if (w.options.every((o) => o.pos === 'adv')) continue;
    if (!w.options.some(isNominal)) break;
    narrow(w, (o) => isNominal(o) && allowed(o));
    members.push(j);
    if (!w.options.some((o) => o.agrees)) break;
  }
  return members;
}

/** A preposition: the readings of `w` whose lemma is a preposition of the trigger list. */
function prepositionReadings(w: Word, idx: TriggerIndex): Option[] {
  return w.options.filter((o) => o.pos === 'prep' && idx.preposition.has(o.lemmaId));
}

/** The value of a number token written in digits, or null. */
function integerOf(text: string): number | null {
  return /^\d+$/u.test(text) ? Number(text) : null;
}

/**
 * Runs the rules on one sentence and returns the governed phrases: the cases a preposition
 * allows, the genitive plural after numerals from five up, then agreement of adjective and
 * noun. Readings are only removed while at least one is left.
 */
export function applyRules(s: WorkSentence, idx: TriggerIndex): Phrase[] {
  const phrases: Phrase[] = [];

  // 1. Prepositions limit the case of the phrase after them.
  for (let j = 0; j < s.tokens.length; j++) {
    const w = s.words[j];
    if (!w) continue;
    const preps = prepositionReadings(w, idx);
    if (preps.length === 0) continue;
    const cases = new Set<Case>();
    for (const p of preps) for (const t of idx.preposition.get(p.lemmaId) ?? []) cases.add(t.case);
    const members = walkPhrase(s, j + 1, (o) => o.case !== undefined && cases.has(o.case));
    if (members.length === 0) continue;
    narrow(w, (o) => preps.includes(o));
    phrases.push({ trigger: j, kind: 'preposition', members, triggers: [] });
  }

  // 2. Numerals from five up, in the nominative or accusative, take the genitive plural.
  const inPrepPhrase = new Map<number, Phrase>();
  for (const p of phrases) for (const m of p.members) inPrepPhrase.set(m, p);
  for (let j = 0; j < s.tokens.length; j++) {
    const tok = s.tokens[j];
    if (!tok) continue;
    const w = s.words[j];
    let triggers: TriggerFacts[] = [];
    if (tok.t === 'num') {
      const n = integerOf(s.texts[j] ?? '');
      if (n === null || n < NUMERAL_FROM) continue;
      // A number inside a phrase whose preposition rules out nominative and accusative
      // (s 5 ženami) takes that case instead.
      const governing = inPrepPhrase.get(j);
      if (governing && !prepAllowsNomAcc(s, governing, idx)) continue;
    } else if (w) {
      const nums = w.options.filter((o) => idx.numeral.has(o.lemmaId));
      if (nums.length === 0) continue;
      const nomAcc = (o: Option) => o.case === 'nom' || o.case === 'acc';
      if (!nums.some(nomAcc)) continue;
      narrow(w, (o) => nums.includes(o) && nomAcc(o));
      narrow(w, (o) => o.number === 'pl');
      for (const o of nums) triggers.push(...(idx.numeral.get(o.lemmaId) ?? []));
      triggers = [...new Map(triggers.map((t) => [t.id, t])).values()];
    } else continue;
    const want: Case = triggers[0]?.case ?? 'gen';
    const members = walkPhrase(s, j + 1, (o) => o.case === want && o.number === 'pl');
    if (members.length === 0) continue;
    // The numeral takes the gender of the counted noun.
    const head = s.words[members[members.length - 1] as number];
    if (w && head) {
      const genders = new Set(head.options.map((o) => o.gender));
      narrow(w, (o) => o.gender === undefined || genders.has(o.gender));
    }
    phrases.push({ trigger: j, kind: 'numeral', members, triggers });
  }

  // 3. Adjectives (and agreeing pronouns) agree with the noun after them.
  const featureKey = (o: Option) => `${o.case}|${o.number}|${o.gender}`;
  for (let h = 0; h < s.tokens.length; h++) {
    const head = s.words[h];
    if (!head?.options.some((o) => o.pos === 'noun')) continue;
    const mods: Word[] = [];
    for (let k = h - 1; k >= 0; k--) {
      const m = s.words[k];
      if (!m?.options.some((o) => o.agrees && !idx.numeral.has(o.lemmaId))) break;
      mods.push(m);
    }
    if (mods.length === 0) continue;
    let shared = new Set(
      head.options
        .filter((o) => o.pos === 'noun' && o.case && o.number && o.gender)
        .map(featureKey),
    );
    for (const m of mods) {
      const own = new Set(m.options.filter((o) => o.agrees).map(featureKey));
      shared = new Set([...shared].filter((k) => own.has(k)));
    }
    if (shared.size === 0) continue;
    narrow(head, (o) => shared.has(featureKey(o)));
    for (const m of mods) narrow(m, (o) => shared.has(featureKey(o)));
  }

  return phrases;
}

function prepAllowsNomAcc(s: WorkSentence, p: Phrase, idx: TriggerIndex): boolean {
  const w = s.words[p.trigger];
  if (!w) return true;
  for (const o of w.options)
    for (const t of idx.preposition.get(o.lemmaId) ?? [])
      if (t.case === 'nom' || t.case === 'acc') return true;
  return false;
}

/**
 * Marks the trigger of each word once every word has its one reading: the preposition
 * before its phrase, a numeral before the counted noun (it wins over a preposition), and a
 * verb of the trigger list for a word in its case in the same clause.
 */
export function assignTriggers(s: WorkSentence, phrases: readonly Phrase[], idx: TriggerIndex) {
  const chosen = (j: number): Option | undefined => s.words[j]?.options[0];
  for (const p of phrases) {
    for (const m of p.members) {
      const w = s.words[m];
      const c = chosen(m);
      if (!w || !c?.case) continue;
      if (p.kind === 'preposition') {
        const prep = chosen(p.trigger);
        const t = prep && idx.preposition.get(prep.lemmaId)?.find((x) => x.case === c.case);
        if (t) w.trig = { i: p.trigger, kind: 'preposition', id: t.id };
      } else if (c.number === 'pl') {
        const t = p.triggers.find((x) => x.case === c.case);
        if (t) w.trig = { i: p.trigger, kind: 'numeral', id: t.id };
        else if (c.case === 'gen' && p.triggers.length === 0)
          w.trig = { i: p.trigger, kind: 'numeral' };
      }
    }
  }

  // Verbs: clauses end at punctuation.
  let start = 0;
  for (let j = 0; j <= s.tokens.length; j++) {
    if (j < s.tokens.length && s.tokens[j]?.t !== 'punct') continue;
    markVerbClause(s, start, j, idx, chosen);
    start = j + 1;
  }
}

function markVerbClause(
  s: WorkSentence,
  from: number,
  to: number,
  idx: TriggerIndex,
  chosen: (j: number) => Option | undefined,
) {
  const verbs: { at: number; triggers: TriggerFacts[] }[] = [];
  for (let j = from; j < to; j++) {
    const c = chosen(j);
    const triggers = c ? idx.verb.get(c.lemmaId) : undefined;
    if (c?.pos === 'verb' && triggers) verbs.push({ at: j, triggers });
  }
  if (verbs.length === 0) return;
  for (let j = from; j < to; j++) {
    const w = s.words[j];
    const c = chosen(j);
    if (!w || w.trig || !c || !isNominal(c)) continue;
    let best: { at: number; id: string } | undefined;
    for (const v of verbs) {
      const t = v.triggers.find((x) => x.case === c.case);
      if (t && (!best || Math.abs(v.at - j) < Math.abs(best.at - j))) best = { at: v.at, id: t.id };
    }
    if (best) w.trig = { i: best.at, kind: 'verb', id: best.id };
  }
}
