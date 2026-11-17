// Exercise items of the declension module: an exercise row of `ling.exercise` turned into the
// `ExerciseItem` the client grades offline (form map, sibling endings, trigger label), and the
// server's second diagnosis of a typed answer. Pure: the data comes from repo.ts.
import {
  type Case,
  type Diagnosis,
  type ErrorType,
  type ExerciseItem,
  type ExerciseKind,
  type FormMap,
  type Gender,
  type GrammaticalNumber,
  normalizeAnswer,
  type TriggerKind,
} from '@app/contracts';
import {
  buildFormMap,
  diagnoseForm,
  errorTypeFor,
  type FormRow,
  formKey,
  readTag,
  tagOf,
  tryParseTag,
} from '@app/ling';

/** An exercise as repo.ts reads it from `ling.exercise`. */
export interface ExerciseData {
  id: string;
  kind: ExerciseKind;
  sentenceSk: string;
  sentenceEn: string;
  target: { start: number; end: number; lemmaIds: number[]; cue: string; answers: string[] };
  case: Case;
  number: GrammaticalNumber;
  gender: Gender;
  pattern: string | null;
  triggerId: string | null;
  options: { text: string; correct: boolean }[] | null;
  lessonId: string | null;
}

export interface LemmaData {
  id: number;
  lemma: string;
  pos: string;
  gender: string | null;
}

export interface PatternData {
  id: string;
  pos: string;
  gender: string | null;
  endings: Record<string, string>;
}

export interface TriggerData {
  id: string;
  kind: TriggerKind;
  lemma: string;
  case: Case;
}

/** Everything `buildExerciseItem` needs besides the exercise itself. */
export interface ItemData {
  forms: Map<number, FormRow[]>;
  lemmas: Map<number, LemmaData>;
  patterns: PatternData[];
  triggers: Map<string, TriggerData>;
}

export const CASE_NAMES: Record<Case, string> = {
  nom: 'nominative',
  gen: 'genitive',
  dat: 'dative',
  acc: 'accusative',
  voc: 'vocative',
  loc: 'locative',
  ins: 'instrumental',
};

/** The label a trigger carries in an item: 'do + genitive'. */
export function triggerLabel(t: { lemma: string; case: Case }): string {
  return `${t.lemma} + ${CASE_NAMES[t.case]}`;
}

/** Masculine animate and inanimate patterns borrow from each other, so they are one family. */
function genderFamily(g: string | null | undefined): string | null {
  if (g === 'm_anim' || g === 'm_inan') return 'm';
  return g ?? null;
}

/** The lemma whose case the exercise tests: the noun of a phrase, else the last word. */
export function headLemmaId(ex: ExerciseData, lemmas: Map<number, LemmaData>): number | undefined {
  const ids = ex.target.lemmaIds;
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i] as number;
    if (lemmas.get(id)?.pos === 'noun') return id;
  }
  return ids[ids.length - 1];
}

/** How many combinations a phrase form map may hold before it falls back to the head word. */
const MAX_PHRASE_FORMS = 400;

/**
 * The form map of a phrase (adjective + noun): every noun tag of the head noun, with the agreeing
 * forms of the other words in front of it, keyed by the whole phrase. Null when a word has no
 * agreeing form for a tag, so the caller falls back to the head word's map.
 */
function phraseFormMap(ex: ExerciseData, head: number, data: ItemData): FormMap | null {
  const ids = ex.target.lemmaIds;
  const headMap = buildFormMap(data.forms.get(head) ?? []);
  const others = ids.map((id) => (id === head ? null : buildFormMap(data.forms.get(id) ?? [])));
  const byTag = new Map<string, string[]>();
  for (const [form, tags] of Object.entries(headMap)) {
    for (const tag of tags) {
      const parsed = tryParseTag(tag);
      if (parsed?.kind !== 'noun') continue;
      const list = byTag.get(tag) ?? [];
      list.push(form);
      byTag.set(tag, list);
    }
  }
  const map: FormMap = {};
  let size = 0;
  for (const [tag, headForms] of byTag) {
    const parsed = tryParseTag(tag);
    if (parsed?.kind !== 'noun') continue;
    const agree = tagOf({ case: parsed.case, number: parsed.number, gender: ex.gender });
    let phrases: string[] = [''];
    for (let i = 0; i < ids.length; i++) {
      const other = others[i];
      const words = other
        ? Object.keys(other).filter((f) => other[f]?.includes(agree))
        : (headForms as string[]);
      if (words.length === 0) return null;
      phrases = phrases.flatMap((p) => words.map((w) => (p === '' ? w : `${p} ${w}`)));
    }
    for (const p of phrases) {
      const list = map[p] ?? [];
      if (!list.includes(tag)) list.push(tag);
      map[p] = list;
      size += 1;
      if (size > MAX_PHRASE_FORMS) return null;
    }
  }
  return map;
}

/** The form map of the exercise's target: one word, or the whole phrase. */
export function formMapOf(ex: ExerciseData, data: ItemData): FormMap {
  const head = headLemmaId(ex, data.lemmas);
  if (head === undefined) return {};
  if (ex.target.lemmaIds.length > 1) {
    const phrase = phraseFormMap(ex, head, data);
    if (phrase) return phrase;
  }
  return buildFormMap(data.forms.get(head) ?? []);
}

/** The tag of the expected form: the tag of the first answer that matches the features. */
export function expectedTagOf(
  ex: { answers: readonly string[]; case: Case; number: GrammaticalNumber; gender: Gender },
  formMap: FormMap,
): string {
  const first = ex.answers[0];
  const tags = first === undefined ? [] : (formMap[formKey(first)] ?? []);
  for (const tag of tags) {
    if (tryParseTag(tag) === null) continue;
    const r = readTag(tag, ex.gender);
    if (r.case === ex.case && r.number === ex.number && (r.gender ?? ex.gender) === ex.gender)
      return tag;
  }
  return tagOf({ case: ex.case, number: ex.number });
}

/**
 * Pattern id → the ending that pattern has for the expected noun tag, over the noun patterns of
 * the target's gender family. The target's own pattern is included, so `diagnoseForm` cuts the
 * exact stem. Only for one word targets with a pattern.
 */
export function siblingEndingsOf(
  ex: ExerciseData,
  patterns: readonly PatternData[],
): Record<string, string> | undefined {
  if (!ex.pattern || ex.target.lemmaIds.length !== 1) return undefined;
  const own = patterns.find((p) => p.id === ex.pattern);
  if (own?.pos !== 'noun') return undefined;
  const tag = tagOf({ case: ex.case, number: ex.number });
  if (own.endings[tag] === undefined) return undefined;
  const family = genderFamily(ex.gender);
  const out: Record<string, string> = {};
  for (const p of patterns) {
    if (p.pos !== 'noun' || genderFamily(p.gender) !== family) continue;
    const ending = p.endings[tag];
    if (ending !== undefined) out[p.id] = ending;
  }
  return Object.keys(out).length > 1 ? out : undefined;
}

/** The ExerciseItem of an exercise: everything the client needs to grade it offline. */
export function buildExerciseItem(ex: ExerciseData, data: ItemData): ExerciseItem {
  const formMap = formMapOf(ex, data);
  const item: ExerciseItem = {
    exerciseId: ex.id,
    kind: ex.kind,
    sentenceSk: ex.sentenceSk,
    sentenceEn: ex.sentenceEn,
    blank: { start: ex.target.start, end: ex.target.end },
    cue: ex.target.cue,
    answers: [...ex.target.answers],
    features: {
      case: ex.case,
      number: ex.number,
      gender: ex.gender,
      ...(ex.pattern ? { pattern: ex.pattern } : {}),
    },
    formMap,
  };
  if (ex.kind !== 'cloze' && ex.options) item.options = ex.options.map((o) => ({ ...o }));
  const trigger = ex.triggerId ? data.triggers.get(ex.triggerId) : undefined;
  if (trigger) item.trigger = { id: trigger.id, kind: trigger.kind, label: triggerLabel(trigger) };
  const siblings = siblingEndingsOf(ex, data.patterns);
  if (siblings) item.siblingEndings = siblings;
  return item;
}

export interface ServerDiagnosis {
  correct: boolean;
  /** Null for a meaning choice, which names no form. */
  diagnosis: Diagnosis | null;
  errorType: ErrorType | null;
  /** The case of the form given, for `other_case`. */
  givenCase: Case | null;
}

/**
 * The server's second diagnosis of an answer (the client's is not trusted). A meaning choice
 * is right when the text is the right option's; a wrong one is `case_other` without a diagnosis.
 * Form choices and typed gaps go through `diagnoseForm` and `errorTypeFor`.
 */
export function diagnoseAnswer(item: ExerciseItem, typed: string): ServerDiagnosis {
  if (item.kind === 'choice_meaning') {
    const right = (item.options ?? []).find((o) => o.correct);
    const correct = right !== undefined && normalizeAnswer(right.text) === normalizeAnswer(typed);
    return correct
      ? { correct: true, diagnosis: 'correct', errorType: null, givenCase: null }
      : { correct: false, diagnosis: null, errorType: 'case_other', givenCase: null };
  }
  const d = diagnoseForm(typed, {
    answers: item.answers,
    formMap: item.formMap,
    siblingEndings: item.siblingEndings,
    pattern: item.features.pattern,
    gender: item.features.gender,
  });
  const expectedTag = expectedTagOf({ answers: item.answers, ...item.features }, item.formMap);
  const errorType = errorTypeFor(d.diagnosis, { triggerKind: item.trigger?.kind, expectedTag });
  let givenCase: Case | null = null;
  if (d.diagnosis === 'other_case') {
    const withCase = d.readings.filter((r) => r.case !== undefined);
    const best = withCase.find((r) => r.number === item.features.number) ?? withCase[0];
    givenCase = best?.case ?? null;
  }
  return { correct: d.diagnosis === 'correct', diagnosis: d.diagnosis, errorType, givenCase };
}
