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
  /** The verb rows by the lemma as written: a negated verb has a lemma of its own (*nemať*). */
  verbByLemma: Map<string, TriggerFacts[]>;
}

export function indexTriggers(rows: readonly TriggerFacts[]): TriggerIndex {
  const out: TriggerIndex = {
    preposition: new Map(),
    numeral: new Map(),
    verb: new Map(),
    verbByLemma: new Map(),
  };
  for (const r of rows) {
    if (r.lemmaId === null) continue;
    if (r.kind === 'verb') {
      const key = r.lemma.normalize('NFC').toLowerCase();
      out.verbByLemma.set(key, [...(out.verbByLemma.get(key) ?? []), r]);
    }
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

  const open = joinedAfterPreposition(s, chosen);

  // Verbs: a clause ends at punctuation and at a conjunction before a verb with a subject.
  // A hyphen inside a word ends nothing (e-maily, česko-slovenský).
  const inWord = (j: number) => {
    const t = s.tokens[j];
    return s.texts[j] === '-' && s.tokens[j - 1]?.e === t?.s && s.tokens[j + 1]?.s === t?.e;
  };
  let start = 0;
  for (let j = 0; j <= s.tokens.length; j++) {
    if (j < s.tokens.length && (s.tokens[j]?.t !== 'punct' || inWord(j))) continue;
    for (const [from, to] of clausesOf(start, j, chosen))
      markVerbClause(s, from, to, idx, chosen, open);
    start = j + 1;
  }
}

type Chosen = (j: number) => Option | undefined;

/** The letters of a verb tag after `v:`: the form (I, K, L, B, M), the aspect, number, person. */
const verbDetail = (o: Option) =>
  o.pos === 'verb' && o.tag?.startsWith('v:') ? o.tag.slice(2) : '';
const isInfinitive = (o: Option) => verbDetail(o).startsWith('I');

/**
 * The lemma of a verb reading without its negation: the data files a negated form under a
 * lemma of its own (*nemám* under *nemať*, *nešiel* under *nejsť*).
 */
function verbLemma(o: Option): string {
  const lemma = lower(o.lemma);
  if (!verbDetail(o).endsWith('-') || !lemma.startsWith('ne')) return lemma;
  return lemma === 'nejsť' ? 'ísť' : lemma.slice(2);
}

/** *som*, *si*, *sme*, *ste*: with a past form they only build the tense (*čítal som*). */
const isPastAuxiliary = (o: Option) => verbLemma(o) === 'byť' && /^K.[sp][ab]/u.test(verbDetail(o));

/** Words that join two words or phrases of the same kind (*chlieb a maslo*). */
const JOINING: ReadonlySet<string> = new Set(['a', 'i', 'aj', 'alebo', 'ani', 'či']);
const joins = (s: WorkSentence, j: number, chosen: Chosen) => {
  const c = chosen(j);
  return s.texts[j] === ',' || (c?.pos === 'conj' && JOINING.has(lower(c.lemma)));
};

/** Pronouns that open a clause after a comma (*na to, čo som videl*). */
const RELATIVE: ReadonlySet<string> = new Set(['ktorý', 'kto', 'čo', 'aký', 'čí', 'koľko']);

/**
 * A noun phrase joined to the phrase after a preposition stands in the same case for the
 * same reason (*s chlebom a maslom*, *v Prahe, Viedni a Budapešti*): it gets the trigger of
 * the word before the joint. After a comma only a list counts, a phrase that another joint
 * follows. In the accusative the joined phrase can as well be a second object of the verb
 * (*knihu pre mamu a čokoládu pre otca*), so those words are returned instead, and get no
 * reason at all.
 */
function joinedAfterPreposition(s: WorkSentence, chosen: Chosen): Set<number> {
  const open = new Set<number>();
  for (let j = 1; j + 1 < s.tokens.length; j++) {
    const before = s.words[j - 1];
    const head = chosen(j - 1);
    if (before?.trig?.kind !== 'preposition' || !head?.case || !joins(s, j, chosen)) continue;
    const members: number[] = [];
    let complete = false;
    for (let k = j + 1; k < s.tokens.length && !complete; k++) {
      const w = s.words[k];
      const o = chosen(k);
      if (!w || w.trig || !o || !isNominal(o) || o.case !== head.case) break;
      if (RELATIVE.has(lower(o.lemma))) break;
      members.push(k);
      complete = !isModifier(o);
    }
    const after = (members.at(-1) ?? j) + 1;
    if (!complete || (s.texts[j] === ',' && after < s.tokens.length && !joins(s, after, chosen)))
      continue;
    for (const m of members) {
      if (head.case === 'acc') open.add(m);
      else (s.words[m] as Word).trig = { ...before.trig };
    }
  }
  return open;
}

/** Conjunctions that open a clause of their own when a verb with a subject follows. */
const CLAUSE_CONJUNCTIONS: ReadonlySet<string> = new Set([
  'a',
  'ale',
  'alebo',
  'ani',
  'či',
  'lebo',
  'že',
  'keď',
  'ak',
  'aby',
  'keby',
  'kým',
  'pretože',
  'keďže',
  'hoci',
]);

/**
 * Cuts the stretch between two punctuation marks into clauses: at the last conjunction between
 * two verbs (*Čítam e-maily | a potom mám stretnutie*). A conjunction with no verb after it
 * joins words, not clauses (*pijú víno alebo punč*), and *aj* and *i* mostly mean "also". An
 * infinitive belongs to the verb before it (*bude vláda novými a starými opatreniami
 * zabezpečovať*), and so does a past form to its *som* or *sme*.
 */
function clausesOf(from: number, to: number, chosen: Chosen): [number, number][] {
  const out: [number, number][] = [];
  let begin = from;
  let at = -1;
  let cut = -1;
  // True while a som or sme of this clause still waits for its past form (som chlieb kúpil).
  let waits = false;
  let past = false;
  for (let j = from; j < to; j++) {
    const c = chosen(j);
    if (!c) continue;
    if (c.pos === 'verb') {
      const isPast = verbDetail(c).startsWith('L');
      if (at >= 0 && cut > at && !isInfinitive(c) && !(waits && isPast)) {
        out.push([begin, cut]);
        begin = cut + 1;
        waits = false;
        past = false;
      }
      if (isPast) {
        past = true;
        waits = false;
      } else if (isPastAuxiliary(c) && !past) waits = true;
      at = j;
    } else if (c.pos === 'conj' && CLAUSE_CONJUNCTIONS.has(lower(c.lemma))) cut = j;
  }
  out.push([begin, to]);
  return out;
}

/**
 * Verbs that take another verb in the infinitive and have an object rule of their own. With
 * an infinitive after them the object belongs to that verb (*ako ich mám brať*,
 * *chcem ho vidieť*, *mal útočníkov zastaviť*), so they keep only a noun that itself takes
 * the infinitive (*mám čas čítať*).
 */
const WITH_INFINITIVE: ReadonlySet<string> = new Set(['mať', 'chcieť', 'potrebovať', 'zabudnúť']);
/** Nouns an infinitive hangs on: the noun is the object of the verb before it. */
const NOUNS_WITH_INFINITIVE: ReadonlySet<string> = new Set([
  'čas',
  'chuť',
  'možnosť',
  'príležitosť',
  'šanca',
  'dôvod',
  'spôsob',
  'právo',
  'povinnosť',
  'potreba',
  'nutnosť',
  'snaha',
  'túžba',
  'tendencia',
  'sklon',
  'zámer',
  'cieľ',
  'plán',
  'nápad',
  'pokus',
  'schopnosť',
  'odvaha',
  'sila',
  'ochota',
  'záujem',
  'problém',
  'úloha',
  'strach',
  'rozhodnutie',
  'sľub',
  'návrh',
  'povolenie',
  'zákaz',
]);
/** How far after a verb its infinitive stands at most, in tokens (*musím ho dnes vidieť*). */
const CARRY_REACH = 6;

/** Units of time: in the bare accusative they say how long (*čakal hodinu*, *chvíľu spím*). */
const TIME_UNITS: ReadonlySet<string> = new Set([
  'chvíľa',
  'chvíľka',
  'sekunda',
  'minúta',
  'hodina',
  'deň',
  'noc',
  'týždeň',
  'víkend',
  'mesiac',
  'polrok',
  'rok',
  'desaťročie',
  'storočie',
]);
/** Nouns that say when or how long only with one of `TIME_WORDS` (*každý piatok*, *celý život*). */
const TIME_NOUNS: ReadonlySet<string> = new Set([
  ...TIME_UNITS,
  'ráno',
  'dopoludnie',
  'predpoludnie',
  'poludnie',
  'popoludnie',
  'poobedie',
  'večer',
  'pondelok',
  'utorok',
  'streda',
  'štvrtok',
  'piatok',
  'sobota',
  'nedeľa',
  'jar',
  'leto',
  'jeseň',
  'zima',
  'január',
  'február',
  'marec',
  'apríl',
  'máj',
  'jún',
  'júl',
  'august',
  'september',
  'október',
  'november',
  'december',
  'čas',
  'život',
  'semester',
  'sezóna',
  'prázdniny',
  'dovolenka',
]);
const TIME_WORDS: ReadonlySet<string> = new Set([
  'každý',
  'celý',
  'tento',
  'ten',
  'tamten',
  'minulý',
  'budúci',
  'predošlý',
  'predchádzajúci',
  'uplynulý',
  'nasledujúci',
  'ďalší',
  'posledný',
  'niektorý',
  'jeden',
  'prvý',
  'druhý',
  'tretí',
]);

/**
 * An accusative that says when or how long, not what: `always` with a word such as *každý*
 * or *minulý* (*každý mesiac*, *minulý týždeň*, *celý deň*), `unit` for a unit of time alone or
 * counted (*hodinu*, *dva roky*, *päť minút*), which only *mať* takes as its object
 * (*mám hodinu*, *mal som desať rokov*).
 */
function timeAccusative(j: number, from: number, chosen: Chosen): 'always' | 'unit' | undefined {
  const c = chosen(j);
  if (c?.case !== 'acc') return undefined;
  // The noun of the phrase: the word itself, or the noun after its modifiers; a numeral
  // counts its noun in the genitive.
  let head = c.pos === 'noun' ? j : -1;
  if (head < 0 && (isModifier(c) || c.pos === 'num')) {
    for (let k = j + 1; head < 0 && k <= j + 3; k++) {
      const o = chosen(k);
      if (!o || !isNominal(o)) break;
      const counted = c.pos === 'num' && o.case === 'gen';
      if (!counted && !(o.case === 'acc' && agree(c, o))) break;
      if (o.pos === 'noun') head = k;
    }
  }
  const noun = head < 0 ? undefined : chosen(head);
  if (!noun || !TIME_NOUNS.has(lower(noun.lemma))) return undefined;
  for (let k = head - 1; k >= from && k >= head - 4; k--) {
    const o = chosen(k);
    if (!o || !isNominal(o) || o.pos === 'noun' || isPersonal(o)) break;
    if (TIME_WORDS.has(lower(o.lemma))) return 'always';
  }
  return TIME_UNITS.has(lower(noun.lemma)) ? 'unit' : undefined;
}

interface ClauseVerb {
  at: number;
  lemma: string;
  detail: string;
  infinitive: boolean;
  triggers: readonly TriggerFacts[];
}

/**
 * Names the verb that asks for the case of a word, in one clause: the nearest verb of the
 * trigger list with a rule for that case. A reason that may be wrong is left out, since a
 * missing reason costs the reader nothing and a wrong one teaches a wrong rule:
 * - *som*, *si*, *sme*, *ste* beside a past form (*my sme sa rozprávali*) and *budem* before
 *   an infinitive only build the tense: they are no *byť* with a nominative;
 * - a verb with an infinitive after it leaves the object to that verb (`WITH_INFINITIVE`);
 * - a verb without a rule for the case that stands nearer is the likelier reason
 *   (*túžba robiť hlúposti ma neopustila*);
 * - the words after *ako* or *než* stand in the case of what they are compared with;
 * - an accusative of time says when or how long (`timeAccusative`);
 * - a genitive right after a noun belongs to that noun (*chovanci ústavu*);
 * - an instrumental with *byť* is a job or a role only where it can be what is said of the
 *   subject (`saidOfSubject`).
 */
function markVerbClause(
  s: WorkSentence,
  from: number,
  to: number,
  idx: TriggerIndex,
  chosen: Chosen,
  open: ReadonlySet<number>,
) {
  const all: ClauseVerb[] = [];
  for (let j = from; j < to; j++) {
    const c = chosen(j);
    if (c?.pos !== 'verb') continue;
    const lemma = verbLemma(c);
    all.push({
      at: j,
      lemma,
      detail: verbDetail(c),
      infinitive: isInfinitive(c),
      triggers: idx.verb.get(c.lemmaId) ?? idx.verbByLemma.get(lemma) ?? [],
    });
  }
  const infinitiveAfter = (at: number) => all.find((v) => v.infinitive && v.at > at)?.at;
  /** True for a verb that only carries the infinitive right after it (musím ho dnes vidieť). */
  const carries = (v: ClauseVerb) => {
    const inf = infinitiveAfter(v.at);
    return inf !== undefined && inf <= v.at + CARRY_REACH;
  };
  const past = all.some((v) => v.detail.startsWith('L'));
  const builds = (v: ClauseVerb) =>
    v.lemma === 'byť' &&
    ((past && /^K.[sp][ab]/u.test(v.detail)) ||
      (v.detail.startsWith('B') && infinitiveAfter(v.at) !== undefined));
  const verbs = all.filter((v) => v.triggers.length > 0 && !builds(v));
  if (verbs.length === 0) return;

  // Words in a comparison: from ako or než to the next verb. An ako that opens the clause of a
  // verb is "how" or "as" (ako ich mám brať): only a nominative right after it is set apart
  // (ako dieťa som mal psa).
  const apart = new Set<number>();
  for (let j = from; j < to; j++) {
    const c = chosen(j);
    if (!c || (lower(c.lemma) !== 'ako' && lower(c.lemma) !== 'než')) continue;
    const opens = j === from && all.some((v) => v.at > j);
    for (let k = j + 1; k < to; k++) {
      const o = chosen(k);
      if (o?.pos === 'verb' || (opens && !(o && isNominal(o) && o.case === 'nom'))) break;
      apart.add(k);
    }
  }
  // A genitive right after a noun, and the words of its phrase and those joined to it.
  for (let j = from + 1; j < to; j++) {
    const c = chosen(j);
    if (!c || !isNominal(c) || c.case !== 'gen') continue;
    const before = chosen(j - 1);
    const sameCase = before && isNominal(before) && before.case === 'gen';
    if (
      before?.pos === 'noun' ||
      (apart.has(j - 1) && sameCase && isModifier(before)) ||
      (j - 2 >= from &&
        joins(s, j - 1, chosen) &&
        apart.has(j - 2) &&
        chosen(j - 2)?.case === 'gen')
    )
      apart.add(j);
  }

  let nominatives: number | undefined;
  /**
   * How many groups of nominative words the clause has. Joined words are one group, and so
   * are words with only a genitive or *jeho*, *jej*, *ich* between them (*zníženie
   * nezamestnanosti a zvýšenie efektívnosti*).
   */
  const nominativeGroups = () => {
    if (nominatives !== undefined) return nominatives;
    nominatives = 0;
    let inside = false;
    for (let j = from; j < to; j++) {
      const o = chosen(j);
      if (o && isNominal(o) && o.case === 'nom') {
        if (!inside) nominatives++;
        inside = true;
      } else if (
        !joins(s, j, chosen) &&
        !(o && isNominal(o) && o.case === 'gen') &&
        !(o?.pos === 'pron' && o.case === undefined)
      )
        inside = false;
    }
    return nominatives;
  };
  /**
   * True when an instrumental can be what *byť* says of the subject (*otec je lekárom*). It
   * does not hang on the adjective beside it (*pokryté snehom*, *vládou vypracovaný*) or on
   * the noun before it (*cesta vlakom*), unless that noun is the subject after the verb
   * (*je Malta členom*) or ends a phrase with a preposition (*bol v škole kapitánom*). And
   * the clause says nothing else of the subject in the nominative (*je to autom desať minút*).
   */
  const saidOfSubject = (j: number, verbAt: number) => {
    const instrumental = (k: number) => {
      const o = chosen(k);
      return o !== undefined && isNominal(o) && o.case === 'ins';
    };
    let first = j;
    while (first - 1 >= from && instrumental(first - 1)) first--;
    let last = j;
    while (last + 1 < to && instrumental(last + 1)) last++;
    // Not the rest of a phrase after a preposition (pred obradom samotným), and no tým on
    // its own (tým bola vojna ukončená).
    for (let k = first; k <= last; k++) if (s.words[k]?.trig?.kind === 'preposition') return false;
    if (first === last && lower(chosen(j)?.lemma ?? '') === 'ten') return false;
    const before = first - 1 >= from ? chosen(first - 1) : undefined;
    const after = last + 1 < to ? chosen(last + 1) : undefined;
    if (before?.pos === 'adj') return false;
    if (after?.pos === 'adj' && after.case !== 'gen') return false;
    if (
      before?.pos === 'noun' &&
      !(before.case === 'nom' && verbAt < first) &&
      s.words[first - 1]?.trig?.kind !== 'preposition'
    )
      return false;
    return nominativeGroups() <= 1;
  };

  for (let j = from; j < to; j++) {
    const w = s.words[j];
    const c = chosen(j);
    if (!w || w.trig || !c || !isNominal(c) || apart.has(j) || open.has(j)) continue;
    // A name after the noun it names keeps the nominative (šéfredaktor týždenníka Október).
    const named = j > from ? chosen(j - 1) : undefined;
    if (
      c.case === 'nom' &&
      named?.pos === 'noun' &&
      named.case !== 'nom' &&
      !s.words[j - 1]?.trig &&
      /^\p{Lu}/u.test(s.texts[j] ?? '')
    )
      continue;
    const time = timeAccusative(j, from, chosen);
    if (time === 'always') continue;
    // The noun of the phrase the word stands in, when that noun takes an infinitive.
    let noun = c.pos === 'noun' ? j : -1;
    for (let k = j + 1; noun < 0 && k < to && k <= j + 3; k++) {
      const o = chosen(k);
      if (!o || !isNominal(o) || o.case !== c.case) break;
      if (o.pos === 'noun') noun = k;
    }
    const takesInfinitive =
      noun >= 0 && NOUNS_WITH_INFINITIVE.has(lower((chosen(noun) as Option).lemma));
    let best: { at: number; id: string } | undefined;
    for (const v of verbs) {
      const t = v.triggers.find((x) => x.case === c.case);
      if (!t) continue;
      if (time === 'unit' && v.lemma !== 'mať') continue;
      if (WITH_INFINITIVE.has(v.lemma)) {
        const inf = infinitiveAfter(v.at);
        if (inf !== undefined && !(takesInfinitive && j > v.at && noun < inf)) continue;
      }
      if (v.lemma === 'byť' && c.case === 'ins' && !saidOfSubject(j, v.at)) continue;
      // pocítil potrebu písať: the noun is no object of the infinitive after it.
      if (v.infinitive && takesInfinitive && noun < v.at) continue;
      if (!best || Math.abs(v.at - j) < Math.abs(best.at - j)) best = { at: v.at, id: t.id };
    }
    if (!best) continue;
    // A verb with no rule for this case that stands nearer is the likelier reason. One with
    // an infinitive after it only carries that verb (musím ho vidieť); an infinitive takes
    // no subject and no word before it (mám čas čítať, je schopný konkurovať).
    const reach = Math.abs(best.at - j);
    const nearer = all.some(
      (v) =>
        Math.abs(v.at - j) < reach &&
        !builds(v) &&
        !carries(v) &&
        !(v.infinitive && (c.case === 'nom' || j < v.at)) &&
        !v.triggers.some((x) => x.case === c.case),
    );
    if (!nearer) w.trig = { i: best.at, kind: 'verb', id: best.id };
  }
}
