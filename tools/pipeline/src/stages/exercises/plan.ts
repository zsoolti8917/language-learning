// The plan of the exercise bank: for every bucket of every lesson, a list of slots. A slot is
// one exercise to write: a target word (or an adjective and its noun) in the bucket's form,
// and the trigger that demands it. Words, forms and triggers all come from the data; the model
// only writes the sentence around them.
import type { Case, Gender, GrammaticalNumber, TriggerKind, TriggerRow } from '@app/contracts';
import { type Bucket, formKey, parseBucketKey, tagOf } from '@app/ling';
import type { AuthoredLesson } from '../lessons';
import { lessonBuckets } from '../lessons';
import { formsWith, type MorphLemma, type Morphology } from '../triggers/morphology';
import { triggerSay, triggerSpellings } from '../triggers';

export interface PlanTrigger {
  id: string;
  kind: TriggerKind;
  lemma: string;
  case: Case;
  meaningEn: string;
  contrastGroup?: string;
  /** The form shown to the model. */
  say: string;
  /** Spellings (formKey) that count as this trigger in a sentence. */
  spellings: ReadonlySet<string>;
}

export interface SlotWord {
  lemmaId: number;
  lemma: string;
  role: 'noun' | 'pronoun' | 'adjective';
  /** The form tag of this word in the gap. */
  tag: string;
  /** Every form of the lemma with that tag. */
  forms: string[];
}

export interface Slot {
  /** `acc.sg.f/007` */
  slot: string;
  index: number;
  bucket: Bucket;
  /** The lesson the exercise belongs to (every fifth goes to `mixed`). */
  lessonId: string;
  trigger: PlanTrigger;
  /** One word, or an adjective and its noun. */
  words: SlotWord[];
  /** The suggested gap text. */
  gap: string;
  cue: string;
  pattern?: string;
}

export interface PlanOptions {
  /** Exercises wanted per bucket. */
  perBucket: number;
  /** Slots per wanted exercise, to make up for rejections. */
  overshoot: number;
  /** Highest rank of a target noun and of the other words. */
  vocabularyLimit: number;
  /** Highest rank of an adjective in a phrase. */
  adjectiveLimit: number;
  /** Only these bucket keys (all when empty). */
  buckets?: readonly string[];
}

export const DEFAULT_PLAN: PlanOptions = {
  perBucket: 40,
  overshoot: 1.25,
  vocabularyLimit: 3000,
  adjectiveLimit: 1500,
};

export const MIXED_LESSON = 'mixed';
const GENDER_LETTER: Record<Gender, string> = { m_anim: 'm', m_inan: 'i', f: 'f', n: 'n' };

/** The lemmas whose forms the plan needs. */
export function planLemmaFilter(
  lessons: readonly AuthoredLesson[],
  triggers: readonly TriggerRow[],
  opts: PlanOptions,
): (l: MorphLemma) => boolean {
  const pronouns = new Set(lessons.flatMap((l) => l.pronouns ?? []));
  const triggerIds = new Set(triggers.map((t) => t.lemmaId).filter((x) => x !== undefined));
  return (l) =>
    (l.pos === 'noun' && (l.freqRank ?? Number.POSITIVE_INFINITY) <= opts.vocabularyLimit) ||
    (l.pos === 'adj' && (l.freqRank ?? Number.POSITIVE_INFINITY) <= opts.adjectiveLimit) ||
    (l.pos === 'pron' && pronouns.has(l.lemma)) ||
    l.pos === 'prep' ||
    triggerIds.has(l.id);
}

export function planTriggers(m: Morphology, rows: readonly TriggerRow[]): Map<string, PlanTrigger> {
  const out = new Map<string, PlanTrigger>();
  for (const t of rows) {
    if (t.lemmaId === undefined) continue;
    const lemma = m.lemmas.get(t.lemmaId);
    if (!lemma || !m.forms.has(lemma.id)) continue;
    const pt: PlanTrigger = {
      id: t.id,
      kind: t.kind,
      lemma: t.lemma,
      case: t.case,
      meaningEn: t.meaningEn,
      say: triggerSay(m, t, lemma),
      spellings: triggerSpellings(m, t, lemma),
    };
    if (t.contrastGroup) pt.contrastGroup = t.contrastGroup;
    out.set(t.id, pt);
  }
  return out;
}

/** Spellings of every preposition, to tell that a gap stands right after one. */
export function prepositionSpellings(m: Morphology): Set<string> {
  const out = new Set<string>();
  for (const l of m.lemmas.values())
    if (l.pos === 'prep') for (const f of Object.keys(m.forms.get(l.id) ?? {})) out.add(f);
  return out;
}

const fits = (t: PlanTrigger, number: GrammaticalNumber) => t.kind !== 'numeral' || number === 'pl';

function word(m: Morphology, l: MorphLemma, role: SlotWord['role'], tag: string): SlotWord | null {
  const forms = formsWith(m.forms.get(l.id), tag);
  if (forms.length === 0) return null;
  return { lemmaId: l.id, lemma: l.lemma, role, tag, forms };
}

/** The slots of one bucket of one lesson. */
export function planBucket(
  m: Morphology,
  lesson: AuthoredLesson,
  bucketKey: string,
  triggers: ReadonlyMap<string, PlanTrigger>,
  opts: PlanOptions,
): Slot[] {
  const bucket = parseBucketKey(bucketKey);
  if (!bucket) throw new Error(`lesson ${lesson.id}: "${bucketKey}" is not a bucket key`);
  const nounTag = tagOf({ case: bucket.case, number: bucket.number });
  const agreeTag = `${nounTag}${GENDER_LETTER[bucket.gender]}`;
  const byRank = (a: MorphLemma, b: MorphLemma) =>
    (a.freqRank ?? Number.POSITIVE_INFINITY) - (b.freqRank ?? Number.POSITIVE_INFINITY) || a.id - b.id;

  let allowed = lesson.triggerIds
    .map((id) => triggers.get(id))
    .filter((t): t is PlanTrigger => t !== undefined && t.case === bucket.case && fits(t, bucket.number));
  if (allowed.length === 0)
    allowed = [...triggers.values()].filter((t) => t.case === bucket.case && fits(t, bucket.number));
  if (allowed.length === 0) return [];
  const forPronouns = allowed.filter((t) => t.kind === 'verb' || t.kind === 'question');

  const nouns: SlotWord[] = [];
  for (const l of [...m.lemmas.values()].sort(byRank)) {
    if (l.pos !== 'noun' || l.gender !== bucket.gender || l.flags.proper || l.flags.indeclinable)
      continue;
    if ((l.freqRank ?? Number.POSITIVE_INFINITY) > opts.vocabularyLimit) continue;
    if (l.pattern === undefined && !l.flags.pluralOnly) continue;
    if (bucket.number === 'sg' && l.flags.pluralOnly) continue;
    const w = word(m, l, 'noun', nounTag);
    if (w) nouns.push(w);
  }
  if (nouns.length === 0) return [];
  const adjectives: { w: SlotWord; nom: string }[] = [];
  for (const l of [...m.lemmas.values()].sort(byRank)) {
    if (l.pos !== 'adj' || l.flags.proper || (l.pattern !== 'pekny' && l.pattern !== 'cudzi')) continue;
    if ((l.freqRank ?? Number.POSITIVE_INFINITY) > opts.adjectiveLimit) continue;
    const w = word(m, l, 'adjective', agreeTag);
    const nom = formsWith(m.forms.get(l.id), `s1${GENDER_LETTER[bucket.gender]}`)[0];
    if (w && nom) adjectives.push({ w, nom });
    if (adjectives.length >= 40) break;
  }
  const pronouns: SlotWord[] = [];
  for (const p of lesson.pronouns ?? []) {
    const l = [...m.lemmas.values()].find((x) => x.pos === 'pron' && x.lemma === p);
    const w = l ? word(m, l, 'pronoun', agreeTag) : null;
    if (w) pronouns.push({ ...w, forms: w.forms.filter((f) => !f.startsWith('n')) });
  }

  const total = Math.ceil(opts.perBucket * opts.overshoot);
  const slots: Slot[] = [];
  let n = 0;
  let p = 0;
  for (let i = 0; i < total; i++) {
    const usePronoun = pronouns.length > 0 && forPronouns.length > 0 && i % 3 === 0;
    const pool = usePronoun ? forPronouns : allowed;
    const trigger = pool[(i + Math.floor(i / pool.length)) % pool.length] as PlanTrigger;
    let words: SlotWord[];
    let cue: string;
    let pattern: string | undefined;
    if (usePronoun) {
      const w = pronouns[p++ % pronouns.length] as SlotWord;
      if (w.forms.length === 0) continue;
      words = [w];
      cue = w.lemma;
    } else {
      const noun = nouns[n++ % nouns.length] as SlotWord;
      const lemma = m.lemmas.get(noun.lemmaId) as MorphLemma;
      pattern = lemma.pattern;
      const adj = i % 4 === 3 && adjectives.length > 0 ? adjectives[Math.floor(i / 4) % adjectives.length] : undefined;
      if (adj) {
        words = [adj.w, noun];
        cue = `${adj.nom} ${noun.lemma}`;
      } else {
        words = [noun];
        cue = noun.lemma;
      }
    }
    const slot: Slot = {
      slot: `${bucketKey}/${String(i).padStart(3, '0')}`,
      index: i,
      bucket,
      lessonId: i % 5 === 4 ? MIXED_LESSON : lesson.id,
      trigger,
      words,
      gap: words.map((w) => w.forms[0]).join(' '),
      cue,
    };
    if (pattern) slot.pattern = pattern;
    slots.push(slot);
  }
  return slots;
}

/** Every slot of every bucket of the lessons (the mixed lesson's buckets are shared). */
export function planAll(
  m: Morphology,
  lessons: readonly AuthoredLesson[],
  triggers: ReadonlyMap<string, PlanTrigger>,
  opts: PlanOptions,
): Slot[] {
  const buckets = lessonBuckets(lessons);
  const slots: Slot[] = [];
  const done = new Set<string>();
  for (const lesson of lessons) {
    if (lesson.buckets === 'all') continue;
    for (const key of buckets.get(lesson.id) ?? []) {
      if (done.has(key)) continue;
      done.add(key);
      if (opts.buckets && opts.buckets.length > 0 && !opts.buckets.includes(key)) continue;
      slots.push(...planBucket(m, lesson, key, triggers, opts));
    }
  }
  return slots;
}

export const keyOf = (w: string) => formKey(w);
