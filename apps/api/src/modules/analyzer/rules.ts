// Pruning rules and trigger detection of the text analyzer. Pure: no ports, no SQL.
// Every rule narrows the readings of a word and never removes the last one. A rule decides only
// through the most frequent lemma of a word: when that lemma does not fit the phrase, the word
// ends the phrase and keeps its readings for the model.
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
  /** Numerals and quantity words (*päť*, *dva*, *veľa*). */
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
        : r.kind === 'numeral' || r.kind === 'quantifier'
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
  /** A number written in digits. */
  digits?: boolean;
}

const NOMINAL_POS: ReadonlySet<Pos> = new Set(['noun', 'adj', 'pron', 'num']);
const isNominal = (o: Option) => o.case !== undefined && NOMINAL_POS.has(o.pos);
const isAdverb = (o: Option) => o.pos === 'adv';
const NUMERAL_FROM = 5;
const nomAcc = (o: Option) => o.case === 'nom' || o.case === 'acc';
const lower = (s: string) => s.normalize('NFC').toLowerCase();

/** Personal pronouns: each is a phrase of its own and never describes the noun after it. */
const PERSONAL: ReadonlySet<string> = new Set([
  'ja',
  'ty',
  'on',
  'ona',
  'ono',
  'my',
  'vy',
  'oni',
  'ony',
  'seba',
]);
const isPersonal = (o: Option) => o.pos === 'pron' && PERSONAL.has(lower(o.lemma));
/** A reading that can describe a noun: it agrees and is no personal pronoun. */
const isModifier = (o: Option) => o.agrees && !isPersonal(o);

/** True when two readings can stand in one phrase: the same case, number and gender. */
function agree(a: Option, b: Option): boolean {
  return (
    a.case === b.case &&
    (a.number === undefined || b.number === undefined || a.number === b.number) &&
    (a.gender === undefined || b.gender === undefined || a.gender === b.gender)
  );
}

/** Keeps the readings that pass `keep`, unless none would be left. Returns true on a change. */
export function narrow(w: Word, keep: (o: Option) => boolean): boolean {
  const kept = w.options.filter(keep);
  if (kept.length === 0 || kept.length === w.options.length) return false;
  w.options = kept;
  return true;
}

/** The members of a phrase and the readings each keeps; nothing is changed until `commit`. */
interface Walk {
  members: number[];
  kept: Option[][];
}

function commit(s: WorkSentence, walk: Walk): void {
  walk.members.forEach((m, i) => {
    const w = s.words[m];
    const kept = walk.kept[i];
    if (w && kept && kept.length > 0) w.options = kept;
  });
}

/**
 * Walks the noun phrase that starts at token `start`: modifiers, then the head. Numbers and
 * adverbs inside are passed over. A word joins the phrase only through its most frequent
 * lemma (the conjunction *a* is never the letter *a*, *bol* never the noun *bola*), and after
 * a modifier only when it agrees with it (*o tom nič*, *v ňom autá* end at the pronoun). A
 * personal pronoun ends the phrase. Each member keeps its nominal readings that `allowed`
 * accepts, and its adverb readings (*po taliansky*, *na večer*) for the model to decide.
 *
 * With `preposition`, *jeho*, *jej*, *ich* are possessive (the pronoun itself would be
 * *neho*, *nej*, *nich*). With `accusative` (a preposition that takes the accusative), the
 * words after a number from five up or a quantity word are genitive, not accusative
 * (*pre 10 európskych štátov*, *na päť dlhých rokov*).
 */
function walkPhrase(
  s: WorkSentence,
  start: number,
  allowed: (o: Option) => boolean,
  opts: { preposition?: boolean; accusative?: boolean; counted?: boolean } = {},
): Walk {
  const walk: Walk = { members: [], kept: [] };
  const afterNumber = (o: Option) => (allowed(o) && o.case !== 'acc') || o.case === 'gen';
  let ok = allowed;
  let previous: Option[] | undefined;
  for (let j = start; j < s.tokens.length; j++) {
    const tok = s.tokens[j];
    if (!tok || tok.t === 'punct') break;
    if (tok.t === 'num') {
      if (opts.accusative && (integerOf(s.texts[j] ?? '') ?? 0) >= NUMERAL_FROM) {
        ok = afterNumber;
        previous = undefined;
      }
      continue;
    }
    const w = s.words[j];
    if (!w) break;
    // Right after a preposition jeho, jej, ich are the possessives: the personal pronoun has
    // its own forms there (od neho, v nej, pre nich). Later in the phrase they can be an
    // object again (po ktorej ich viedol).
    const possessive =
      opts.preposition === true &&
      j === start &&
      w.options.some(isPersonal) &&
      w.options.some(isModifier);
    const readings = possessive ? w.options.filter((o) => !isPersonal(o)) : w.options;
    const top = readings[0];
    if (!top) break;
    if (readings.every(isAdverb)) continue;
    const ofTop = (list: Option[]) => list.some((o) => o.lemmaId === top.lemmaId);
    let candidates = readings.filter((o) => isNominal(o) && ok(o));
    if (!ofTop(candidates)) break;
    // A quantity word keeps its own form after a modifier (za posledných päť rokov).
    const quantity = isQuantityWord(w);
    const before = previous;
    if (before && !quantity) {
      candidates = candidates.filter((o) => before.some((m) => agree(m, o)));
      if (!ofTop(candidates)) break;
    }
    // A number counts no pronoun (roku 1939 ich porazili).
    if (opts.counted && candidates.some(isPersonal)) break;
    const keep = new Set(candidates);
    walk.members.push(j);
    walk.kept.push(w.options.filter((o) => keep.has(o) || isAdverb(o)));
    const modifiers = candidates.filter(isModifier);
    if (modifiers.length === 0) break;
    if (opts.accusative && quantity && candidates.some((o) => o.case === 'acc')) {
      ok = afterNumber;
      previous = undefined;
    } else previous = quantity ? undefined : modifiers;
  }
  return walk;
}

/**
 * True when a walk stops on a modifier although a nominal word follows: the phrase goes on in
 * another case (*v 10 veľkých mestách* is no genitive after the number), so it decides nothing.
 */
function dangling(s: WorkSentence, walk: Walk): boolean {
  const last = walk.members[walk.members.length - 1];
  const kept = walk.kept[walk.kept.length - 1];
  if (last === undefined || !kept) return false;
  if (kept.some((o) => isNominal(o) && !isModifier(o))) return false;
  const next = s.words[last + 1]?.options[0];
  return next !== undefined && isNominal(next);
}

/**
 * A preposition: the readings of `w` whose lemma is a preposition of the trigger list, when
 * the preposition is the word's most frequent reading (*pomocou* is first the noun *pomoc*).
 */
function prepositionReadings(w: Word, idx: TriggerIndex): Option[] {
  if (w.options[0]?.pos !== 'prep') return [];
  return w.options.filter((o) => o.pos === 'prep' && idx.preposition.has(o.lemmaId));
}

/**
 * A word that counts in the genitive when it is itself in the nominative or accusative
 * (*päť žien*, *mnoho generácií*, *zopár otázok*): a numeral in its dictionary form with the
 * neuter singular reading such words have in the data. An ordinal or adjectival numeral
 * (*prvé*, *mnohé*, *ostatné*) has that reading too, but as a form of its lemma.
 */
function isQuantityWord(w: Word): boolean {
  return w.options.some(
    (o) =>
      o.pos === 'num' && (o.tag === 's1n' || o.tag === 's4n') && lower(o.form) === lower(o.lemma),
  );
}

/** The value of a number token written in digits, or null. */
function integerOf(text: string): number | null {
  return /^\d+$/u.test(text) ? Number(text) : null;
}

/**
 * Runs the rules on one sentence and returns the governed phrases: the cases a preposition
 * allows, the genitive after numerals from five up and quantity words, then agreement of
 * adjective and noun. Readings are only removed while at least one is left. A rule decides
 * only for the most frequent lemma of a word; a rarer homograph and an adverb reading are
 * left for the model.
 */
export function applyRules(s: WorkSentence, idx: TriggerIndex): Phrase[] {
  const phrases: Phrase[] = [];

  // 1. Prepositions limit the case of the phrase after them.
  const inPrepPhrase = new Map<number, Phrase>();
  for (let j = 0; j < s.tokens.length; j++) {
    const w = s.words[j];
    if (!w) continue;
    const preps = prepositionReadings(w, idx);
    if (preps.length === 0) continue;
    const cases = new Set<Case>();
    for (const p of preps) for (const t of idx.preposition.get(p.lemmaId) ?? []) cases.add(t.case);
    const walk = walkPhrase(s, j + 1, (o) => o.case !== undefined && cases.has(o.case), {
      preposition: true,
      accusative: cases.has('acc'),
    });
    const last = walk.members[walk.members.length - 1];
    if (last === undefined) continue;
    commit(s, walk);
    narrow(w, (o) => preps.includes(o));
    const phrase: Phrase = { trigger: j, kind: 'preposition', members: walk.members, triggers: [] };
    phrases.push(phrase);
    // Numbers inside the phrase belong to it too.
    for (let k = j + 1; k <= last; k++) inPrepPhrase.set(k, phrase);
  }

  // 2. Numerals. A number from five up and a quantity word, in the dictionary form and in the
  //    nominative or accusative, take the genitive (the plural after a numeral of the trigger
  //    list). dva, tri, štyri (trigger case nominative) and the declined forms of the others
  //    (piatich, piatim) agree with the counted noun in case instead.
  for (let j = 0; j < s.tokens.length; j++) {
    const tok = s.tokens[j];
    if (!tok) continue;
    const w = s.words[j];
    if (tok.t === 'num') {
      const n = integerOf(s.texts[j] ?? '');
      if (n === null || n < NUMERAL_FROM) continue;
      // A number inside a phrase whose preposition rules out nominative and accusative
      // (s 5 ženami) takes that case instead.
      const governing = inPrepPhrase.get(j);
      const cases = governing ? prepCases(s, governing, idx) : undefined;
      if (cases && !cases.has('nom') && !cases.has('acc')) continue;
      const walk = walkPhrase(s, j + 1, (o) => o.case === 'gen' && o.number === 'pl', {
        counted: true,
      });
      if (walk.members.length === 0 || dangling(s, walk)) continue;
      // The phrase may stand in another case of the preposition instead (v 11 storočí as
      // v 11. storočí): then the number decides nothing.
      const other = (o: Option) =>
        o.case !== undefined && o.case !== 'acc' && o.case !== 'gen' && cases?.has(o.case);
      if (cases && walk.members.some((m) => s.words[m]?.options.some(other))) continue;
      commit(s, walk);
      phrases.push({
        trigger: j,
        kind: 'numeral',
        members: walk.members,
        triggers: [],
        digits: true,
      });
      continue;
    }
    if (!w) continue;
    let nums = w.options.filter((o) => idx.numeral.has(o.lemmaId));
    let triggers: TriggerFacts[] = [];
    for (const o of nums) triggers.push(...(idx.numeral.get(o.lemmaId) ?? []));
    triggers = [...new Map(triggers.map((t) => [t.id, t])).values()];
    let plural = true;
    if (nums.length === 0) {
      // Not in the trigger list (zopár, jedenásť): the same rule, any number after it.
      if (!isQuantityWord(w)) continue;
      nums = w.options.filter((o) => o.pos === 'num');
      plural = false;
    }
    if (triggers.some((t) => t.kind === 'quantifier')) plural = false;
    const governs = triggers.length === 0 || triggers.some((t) => t.case === 'gen');
    const bare = nums.some((o) => o.tag === 's1n' || o.tag === 's4n');
    if (!governs || !bare) {
      const p = agreeingNumeral(s, j, w, nums, governs ? [] : triggers);
      if (p) phrases.push(p);
      continue;
    }
    if (!nums.some(nomAcc)) continue;
    // Quantity words are also adverbs (viac ho priťahoval, viac diferencovane): only a noun
    // or adjective in the genitive right after one makes it count.
    const next = s.words[j + 1];
    if (
      !plural &&
      !next?.options.some((o) => (o.pos === 'noun' || o.pos === 'adj') && o.case === 'gen')
    )
      continue;
    const walk = walkPhrase(s, j + 1, (o) => o.case === 'gen' && (!plural || o.number === 'pl'), {
      counted: true,
    });
    if (walk.members.length === 0 || dangling(s, walk)) continue;
    commit(s, walk);
    // The numeral itself is the neuter singular, as the treebank tags it (päť žien prišlo).
    narrow(w, (o) => nums.includes(o) && nomAcc(o));
    narrow(w, (o) => o.tag === 's1n' || o.tag === 's4n');
    phrases.push({ trigger: j, kind: 'numeral', members: walk.members, triggers });
  }

  // 3. Adjectives (and agreeing pronouns) agree with the noun after them. The head is a word
  //    that is first of all a noun (not bola for the verb, not dobré for the adjective), and a
  //    modifier a word that is first of all one (not má of môj for the verb). jej, jeho, ich
  //    before a noun are possessive or an object (dal jej knihu): the model decides.
  const featureKey = (o: Option) => `${o.case}|${o.number}|${o.gender}`;
  for (let h = 0; h < s.tokens.length; h++) {
    const head = s.words[h];
    const top = head?.options[0];
    if (!head || top?.pos !== 'noun') continue;
    const mods: Word[] = [];
    for (let k = h - 1; k >= 0; k--) {
      const m = s.words[k];
      const first = m?.options[0];
      if (!m || !first || isQuantityWord(m) || m.options.some(isPersonal)) break;
      // ktorý after a comma opens a clause; the noun after it is mostly its subject or object
      // (model, ktorý učiteľ vytiahol).
      if (lower(first.lemma) === 'ktorý' && s.texts[k - 1] === ',') break;
      if (
        !m.options.some(
          (o) => o.lemmaId === first.lemmaId && isModifier(o) && !idx.numeral.has(o.lemmaId),
        )
      )
        break;
      mods.push(m);
    }
    if (mods.length === 0) continue;
    let shared = new Set(
      head.options
        .filter((o) => o.pos === 'noun' && o.case && o.number && o.gender)
        .map(featureKey),
    );
    for (const m of mods) {
      const own = new Set(m.options.filter(isModifier).map(featureKey));
      shared = new Set([...shared].filter((k) => own.has(k)));
    }
    // The most frequent lemma of every word must fit, or the words do not belong together.
    const fits = (w: Word) =>
      w.options.some((o) => o.lemmaId === w.options[0]?.lemmaId && shared.has(featureKey(o)));
    if (shared.size === 0 || !fits(head) || !mods.every(fits)) continue;
    narrow(head, (o) => isAdverb(o) || shared.has(featureKey(o)));
    for (const m of mods) narrow(m, (o) => isAdverb(o) || shared.has(featureKey(o)));
  }

  return phrases;
}

/**
 * dva, tri, štyri, and a declined form of a higher numeral (*piatich*, *desiatim*): the
 * counted phrase is plural and in the numeral's own case (*dva roky*, *dvoch chlapov*,
 * *po desiatich dňoch*); the numeral keeps the cases and genders the head allows.
 */
function agreeingNumeral(
  s: WorkSentence,
  j: number,
  w: Word,
  nums: readonly Option[],
  triggers: TriggerFacts[],
): Phrase | undefined {
  const cases = new Set(nums.map((o) => o.case));
  const walk = walkPhrase(
    s,
    j + 1,
    (o) => o.number === 'pl' && o.case !== undefined && cases.has(o.case),
  );
  const head = walk.kept[walk.kept.length - 1];
  if (!head || dangling(s, walk)) return undefined;
  commit(s, walk);
  narrow(
    w,
    (o) =>
      nums.includes(o) &&
      head.some((h) => h.case === o.case && (o.gender === undefined || h.gender === o.gender)),
  );
  return { trigger: j, kind: 'numeral', members: walk.members, triggers };
}

/** The cases the preposition of a phrase allows. */
function prepCases(s: WorkSentence, p: Phrase, idx: TriggerIndex): Set<Case> {
  const cases = new Set<Case>();
  for (const o of s.words[p.trigger]?.options ?? [])
    for (const t of idx.preposition.get(o.lemmaId) ?? []) cases.add(t.case);
  return cases;
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
      } else {
        const t = p.triggers.find((x) => x.case === c.case);
        if (t && (t.kind === 'quantifier' || c.number === 'pl'))
          w.trig = { i: p.trigger, kind: t.kind, id: t.id };
        else if (p.digits && c.case === 'gen' && c.number === 'pl')
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
