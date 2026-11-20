// Rule checks and the rest of an exercise that rules decide (docs/architecture.md, "Generated
// items are verified twice"):
// - the answer is a real form of the target word with the claimed tag;
// - every word of the sentence is a known form, within the vocabulary limit;
// - the trigger stands where it governs the gap;
// - wrong options of choice items are the word's other case forms, never the model's;
// - difficulty, ids.
import type { Case, ExerciseRow, FormMap, GrammaticalNumber } from '@app/contracts';
import { formKey, tagOf } from '@app/ling';
import { sha256 } from '../../lib/files';
import { ADJACENT_KINDS } from '../triggers';
import { CASE_DIGITS, formsWith, type Morphology, wordsOf } from '../triggers/morphology';
import type { Slot, SlotWord } from './plan';

/** Names a sentence may use besides the common words. */
export const NAMES = ['Peter', 'Jana', 'Martin', 'Eva', 'Tomáš', 'Anna', 'Bratislava', 'Slovensko'];
export const MIN_WORDS = 2;
export const MAX_WORDS = 14;

export interface Candidate {
  slot: string;
  sentenceSk: string;
  sentenceEn: string;
  gap: string;
}

export interface CheckedCandidate {
  start: number;
  end: number;
  /** The gap as it stands in the sentence. */
  text: string;
}

export interface RuleContext {
  m: Morphology;
  prepositions: ReadonlySet<string>;
  vocabularyLimit: number;
}

const describeTags = (map: FormMap | undefined, form: string) => (map?.[form] ?? []).join(' ');

/** Checks a written sentence against its slot. Returns the gap's place, or the problems. */
export function checkCandidate(
  c: Candidate,
  slot: Slot,
  rc: RuleContext,
): { ok: true; value: CheckedCandidate } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const text = c.sentenceSk.trim();
  if (!/[.?!]$/u.test(text)) problems.push('the sentence does not end with . ? or !');
  if (c.sentenceEn.trim() === '') problems.push('no translation');
  const words = wordsOf(text);
  if (words.length < MIN_WORDS || words.length > MAX_WORDS)
    problems.push(`${words.length} words, not ${MIN_WORDS} to ${MAX_WORDS}`);
  if (/\p{N}/u.test(text)) problems.push('digits in the sentence');

  // Where is the gap?
  const gapWords = wordsOf(c.gap).map((w) => formKey(w.w));
  if (gapWords.length !== slot.words.length)
    problems.push(`the gap "${c.gap}" has ${gapWords.length} words, not ${slot.words.length}`);
  const at: number[] = [];
  for (let i = 0; i + gapWords.length <= words.length; i++)
    if (
      gapWords.length > 0 &&
      gapWords.every((g, j) => formKey((words[i + j] as { w: string }).w) === g)
    )
      at.push(i);
  if (at.length !== 1) {
    problems.push(
      at.length === 0
        ? `the gap "${c.gap}" is not in the sentence`
        : `the gap "${c.gap}" is in the sentence twice`,
    );
    return { ok: false, problems };
  }
  const first = at[0] as number;
  const gapTokens = words.slice(first, first + gapWords.length);

  // The answer is a real form with the claimed tag.
  slot.words.forEach((w, j) => {
    const form = gapWords[j];
    if (form === undefined) return;
    const map = rc.m.forms.get(w.lemmaId);
    if (!map?.[form]) problems.push(`"${form}" is not a form of ${w.lemma}`);
    else if (!map[form]?.includes(w.tag))
      problems.push(`"${form}" is ${describeTags(map, form)} of ${w.lemma}, not ${w.tag}`);
  });

  // A trigger that stands right before the gap and takes two cases (na, v, za ...) must not
  // leave both open: "na dni" is the locative singular and the accusative plural of deň.
  const trigger = slot.trigger;
  if (ADJACENT_KINDS.has(trigger.kind))
    for (const other of trigger.otherCases) {
      const digit = String(CASE_DIGITS[other]);
      const fitsOther = slot.words.every((w, j) =>
        (rc.m.forms.get(w.lemmaId)?.[gapWords[j] ?? ''] ?? []).some((t) => t[1] === digit),
      );
      if (fitsOther)
        problems.push(
          `"${c.gap}" is also a form of the ${other}, which ${trigger.lemma} takes too`,
        );
    }

  // Every word is known and common; the trigger stands where it governs the gap.
  const isTrigger = (w: string) => trigger.spellings.has(formKey(w));
  const inGap = new Set(gapTokens.map((t) => t.s));
  for (const w of words) {
    if (inGap.has(w.s) || isTrigger(w.w)) continue;
    const info = rc.m.words.get(formKey(w.w));
    if (!info) problems.push(`unknown word "${w.w}"`);
    else if (info.rank > rc.vocabularyLimit && !NAMES.includes(w.w))
      problems.push(
        `rare word "${w.w}" (${Number.isFinite(info.rank) ? `rank ${info.rank}` : 'not ranked'})`,
      );
  }
  const before = words[first - 1];
  if (ADJACENT_KINDS.has(trigger.kind)) {
    if (!before || !isTrigger(before.w))
      problems.push(`the trigger ${trigger.lemma} does not stand right before the gap`);
  } else if (trigger.kind === 'verb') {
    if (!words.some((w) => !inGap.has(w.s) && isTrigger(w.w)))
      problems.push(`no form of the verb ${trigger.lemma} in the sentence`);
    if (before && rc.prepositions.has(formKey(before.w)))
      problems.push(`the preposition "${before.w}" governs the gap, not the verb ${trigger.lemma}`);
  } else if (trigger.kind === 'question') {
    if (!words.slice(0, first).some((w) => isTrigger(w.w)))
      problems.push(`the question word ${trigger.lemma} does not come before the gap`);
  }
  if (problems.length > 0) return { ok: false, problems };
  const start = gapTokens[0]?.s ?? 0;
  const end = gapTokens[gapTokens.length - 1]?.e ?? 0;
  return { ok: true, value: { start, end, text: text.slice(start, end) } };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every accepted answer: each word's forms with its tag, combined in order. */
export function answersOf(slot: Slot, gapText: string, atStart: boolean): string[] {
  const gapForms = wordsOf(gapText).map((w) => formKey(w.w));
  let combos: string[][] = [[]];
  slot.words.forEach((w, j) => {
    // A pronoun keeps the shape of the written one (mu, not nemu after a verb).
    const forms = w.role === 'pronoun' ? [gapForms[j] as string] : w.forms;
    combos = combos.flatMap((c) => forms.map((f) => [...c, f]));
  });
  const out = combos.map((c) => c.join(' '));
  const own = gapForms.join(' ');
  const sorted = [own, ...out.filter((x) => x !== own).sort()];
  return [...new Set(sorted)].map((a) => (atStart ? capital(a) : a));
}

/** Cases tried for wrong options, in order, after the target's own. */
const CONFUSABLE: Record<Case, Case[]> = {
  nom: ['acc', 'gen', 'ins', 'loc', 'dat'],
  gen: ['nom', 'loc', 'acc', 'dat', 'ins'],
  dat: ['loc', 'nom', 'acc', 'gen', 'ins'],
  acc: ['nom', 'gen', 'loc', 'ins', 'dat'],
  voc: ['nom', 'acc', 'gen', 'loc', 'ins'],
  loc: ['nom', 'gen', 'acc', 'dat', 'ins'],
  ins: ['nom', 'loc', 'gen', 'acc', 'dat'],
};

/**
 * Wrong options of a form choice, by rule: the target word's own forms in other cases of the
 * same number (the adjective agreeing), skipping any form that is also an accepted answer.
 */
export function wrongFormOptions(
  m: Morphology,
  slot: Slot,
  answers: readonly string[],
  want = 3,
): string[] {
  const taken = new Set(answers.map(formKey));
  const out: string[] = [];
  const number: GrammaticalNumber = slot.bucket.number;
  for (const c of CONFUSABLE[slot.bucket.case]) {
    const parts = slot.words.map((w: SlotWord) => {
      const gender = w.role === 'noun' ? undefined : slot.bucket.gender;
      const tag = tagOf({ case: c, number, gender });
      return formsWith(m.forms.get(w.lemmaId), tag)[0];
    });
    if (parts.some((p) => p === undefined)) continue;
    const text = parts.join(' ');
    if (taken.has(formKey(text))) continue;
    taken.add(formKey(text));
    out.push(text);
    if (out.length >= want) break;
  }
  return out;
}

const hashOrder = <T extends { text: string }>(xs: T[], salt: string) =>
  [...xs].sort((a, b) => (sha256(`${salt}|${a.text}`) < sha256(`${salt}|${b.text}`) ? -1 : 1));

/** `ex-` + the first ten hex digits of the hash of kind, sentence, target, bucket and trigger. */
export function exerciseId(
  kind: string,
  sentenceSk: string,
  target: ExerciseRow['target'],
  bucket: string,
  triggerId: string,
): string {
  return `ex-${sha256(`${kind}|${sentenceSk}|${target.start}-${target.end}|${target.answers.join('/')}|${bucket}|${triggerId}`).slice(0, 10)}`;
}

/**
 * Difficulty from 0 (easy) to 1: sentence length, the rarest other word, the rank of the
 * target word, a phrase gap, the plural, and typing instead of choosing.
 */
export function difficultyOf(
  rc: RuleContext,
  slot: Slot,
  sentenceSk: string,
  start: number,
  end: number,
  kind: ExerciseRow['kind'],
): number {
  const words = wordsOf(sentenceSk);
  const len = Math.min(1, Math.max(0, (words.length - 3) / 9));
  const scale = (rank: number) =>
    Number.isFinite(rank)
      ? Math.log1p(Math.min(rank, rc.vocabularyLimit)) / Math.log1p(rc.vocabularyLimit)
      : 1;
  let rarest = 0;
  for (const w of words) {
    if (w.s >= start && w.e <= end) continue;
    if (slot.trigger.spellings.has(formKey(w.w))) continue;
    const info = rc.m.words.get(formKey(w.w));
    if (info && !info.properOnly && !NAMES.includes(w.w))
      rarest = Math.max(rarest, scale(info.rank));
  }
  const noun = slot.words[slot.words.length - 1];
  const target = noun
    ? scale(rc.m.lemmas.get(noun.lemmaId)?.freqRank ?? Number.POSITIVE_INFINITY)
    : 0;
  const d =
    0.1 +
    0.25 * len +
    0.2 * rarest +
    0.2 * target +
    (slot.words.length > 1 ? 0.15 : 0) +
    (slot.bucket.number === 'pl' ? 0.05 : 0) +
    (kind === 'cloze' ? 0.05 : 0);
  return Math.round(Math.min(1, Math.max(0, d)) * 100) / 100;
}

export type ExerciseKind = ExerciseRow['kind'];

/** The kind of a slot's exercise: every fourth a choice (of meaning for contrast triggers). */
export function kindOf(slot: Slot): ExerciseKind {
  if (slot.index % 4 !== 1) return 'cloze';
  if (slot.trigger.contrastGroup && Math.floor(slot.index / 4) % 2 === 0) return 'choice_meaning';
  return 'choice_form';
}

/** Builds the exercise row of a checked sentence. */
export function buildRow(
  rc: RuleContext,
  slot: Slot,
  c: Candidate,
  checked: CheckedCandidate,
  contrast: ReadonlyMap<string, { id: string; meaningEn: string }[]>,
  flags: Record<string, unknown>,
): ExerciseRow {
  const sentenceSk = c.sentenceSk.trim();
  const atStart = checked.start === 0;
  const answers = answersOf(slot, checked.text, atStart);
  let kind = kindOf(slot);
  let options: { text: string; correct: boolean }[] | undefined;
  if (kind === 'choice_form') {
    const wrong = wrongFormOptions(rc.m, slot, answers);
    if (wrong.length < 2) kind = 'cloze';
    else
      options = hashOrder(
        [
          { text: answers[0] as string, correct: true },
          ...wrong.map((w) => ({ text: atStart ? capital(w) : w, correct: false })),
        ],
        sentenceSk,
      );
  } else if (kind === 'choice_meaning') {
    const group = contrast.get(slot.trigger.contrastGroup ?? '') ?? [];
    options = hashOrder(
      group.map((t) => ({ text: t.meaningEn, correct: t.id === slot.trigger.id })),
      sentenceSk,
    );
    if (options.filter((o) => o.correct).length !== 1 || options.length < 2) {
      kind = 'cloze';
      options = undefined;
    }
  }
  const target: ExerciseRow['target'] = {
    start: checked.start,
    end: checked.end,
    lemmaIds: slot.words.map((w) => w.lemmaId),
    cue: slot.cue,
    answers,
  };
  const row: ExerciseRow = {
    id: exerciseId(
      kind,
      sentenceSk,
      target,
      `${slot.bucket.case}.${slot.bucket.number}.${slot.bucket.gender}`,
      slot.trigger.id,
    ),
    kind,
    sentenceSk,
    sentenceEn: c.sentenceEn.trim(),
    target,
    case: slot.bucket.case,
    number: slot.bucket.number,
    gender: slot.bucket.gender,
    triggerId: slot.trigger.id,
    lessonId: slot.lessonId,
    difficulty: difficultyOf(rc, slot, sentenceSk, checked.start, checked.end, kind),
    source: 'generated',
    verified: false,
    flags,
  };
  if (slot.pattern) row.pattern = slot.pattern;
  if (options) row.options = options;
  return row;
}
