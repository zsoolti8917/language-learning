// Checks for the answers of an offline fill (`--fill offline`, docs/content-build.md) before
// a stage reads them. The runner accepts an answer when its JSON fits the schema and the
// task's own check; the stage then drops every item that fails its rules. A writer outside
// the API can do better than a batch: `lint` runs the same schema, check and rules on an
// answer file and names each problem (which word is rare, why the target is missing), so the
// writer mends the item instead of losing it. It also prints hints from the morphology
// (grammar.ts) and renders requests compactly for reading.
//
// A writer who finds no natural sentence for an item writes SKIP as its sentence. The answer
// must still name every item, and the stage's rules drop a SKIP like any other sentence
// that fails them; `lint` reports it as left out, not as a problem to mend.
import { readFile } from 'node:fs/promises';
import { type Disambiguation, DisambiguationSchema } from '@app/api/modules/analyzer/model';
import {
  type GlossAnswer as ReaderGlossAnswer,
  GlossAnswerSchema as ReaderGlossAnswerSchema,
} from '@app/api/modules/lexicon/service';
import { tokenize } from '@app/ling';
import { existsSync, listFiles, writeFileAtomic } from '../lib/files';
import type { Paths } from '../lib/paths';
import { offlineAnswersDir, offlineRequestsDir } from '../model/options';
import { type GlossAnswer, type GlossRequest, glossesTask } from '../model/prompts/content-glosses';
import { type BatchTask, type OfflineRequest, offlinePath, validateAnswer } from '../model/runner';
import {
  type DisambiguationInput,
  disambiguationProblems,
  type GlossInput,
  glossProblems,
} from '../stages/analysis/answers';
import {
  type AuditRequest,
  auditExercisesTask,
  auditGlossesTask,
  auditSentencesTask,
  type ExerciseAuditItem,
  type GlossAuditItem,
  type SentenceAuditItem,
} from '../stages/audit/prompts';
import {
  DEFAULT_PLAN,
  planAll,
  planLemmaFilter,
  planTriggers,
  prepositionSpellings,
  type Slot,
} from '../stages/exercises/plan';
import {
  type ExerciseAnswer,
  type ExerciseRequest,
  type ReviewRequest as ExerciseReviewRequest,
  reviewTask as exerciseReviewTask,
  exercisesTask,
} from '../stages/exercises/prompts';
import { checkCandidate, type RuleContext } from '../stages/exercises/rules';
import { readAuthoredLessons } from '../stages/lessons';
import {
  type ReviewInput as LibraryReviewInput,
  reviewTask as libraryReviewTask,
} from '../stages/library/review';
import { type Analysis, analyse, lemmasOf } from '../stages/sentences/analyze';
import {
  type Lexicon,
  type LexLemma,
  lexiconFiles,
  loadLexicon,
} from '../stages/sentences/lexicon';
import {
  type SentenceAnswer,
  type SentenceItem,
  type SentenceRequest,
  type ReviewRequest as SentenceReviewRequest,
  reviewTask as sentenceReviewTask,
  sentencesTask,
  type TranslateRequest,
  translateTask,
} from '../stages/sentences/prompts';
import { MAX_WORDS, MIN_WORDS, requestedTarget } from '../stages/sentences/rules';
import { authoredDir, readTriggerRows, triggersOut } from '../stages/triggers';
import { defaultMorphFiles, loadMorphology } from '../stages/triggers/morphology';
import { grammarHints } from './grammar';

/** Example sentences use words ranked up to this (stages/sentences, SENTENCE_TOP). */
const SENTENCE_TOP = 3000;
/** The sentence of an item the writer leaves out. */
export const SKIP = 'SKIP';

export interface ItemReport {
  /** The item's own id in the request: n, key or slot. */
  id: string;
  /** What makes the stage reject the item. */
  errors: string[];
  /** What a writer or reviewer should look at again. */
  hints: string[];
  /** The writer left the item out (SKIP). */
  skipped?: boolean;
}

export interface RequestReport {
  hash: string;
  /** `missing`: no answer file. `invalid`: the runner would refuse the whole answer. */
  state: 'missing' | 'invalid' | 'checked';
  problem?: string;
  items: ItemReport[];
}

interface Pair<I, O> {
  request: OfflineRequest;
  input: I;
  output: O;
}

interface RouteSpec<I, O> {
  /** What makes an answer valid: the schema and the check of the route's task. */
  task: Pick<BatchTask<I, O>, 'schema' | 'check'>;
  /** The task's input, rebuilt from the user message of a request. */
  input(user: string): I;
  /** The request in a compact form a writer can read. */
  show(input: I): string[];
  /** Rules beyond schema and check, per item. */
  deep?(paths: Paths, pairs: Pair<I, O>[]): Promise<Map<string, ItemReport[]>>;
  /**
   * For `put` and `skip`: the answer of a request from a writer's own list of items, with
   * SKIP for every item of the request the list does not have; null when the list is not
   * about this request. `used` collects the items it took.
   */
  fill?(input: I, items: readonly unknown[], used: Set<unknown>, all: boolean): O | null;
}

// biome-ignore lint/suspicious/noExplicitAny: one table for tasks of different shapes
type AnySpec = RouteSpec<any, any>;

const tab = (...cells: (string | number | undefined)[]) => cells.map((c) => c ?? '').join('\t');
const wordsIn = (text: string) =>
  tokenize(text)
    .filter((t) => t.t === 'word')
    .map((t) => text.slice(t.s, t.e));

// --- content.glosses --------------------------------------------------------------------------

const SLOVAK_LETTER = /[áäčďéíĺľňóôŕšťúýž]/iu;

function glossHints(pos: string, glosses: readonly string[]): string[] {
  const hints: string[] = [];
  for (const g of glosses) {
    if (pos === 'verb' && !g.startsWith('to '))
      hints.push(`verb gloss "${g}" does not start with "to"`);
    if (pos !== 'verb' && g.startsWith('to ') && pos !== 'prep' && pos !== 'part' && pos !== 'adv')
      hints.push(`gloss "${g}" starts with "to" but the word is ${pos}`);
    if (/[.!?]$/u.test(g)) hints.push(`gloss "${g}" ends with punctuation`);
    if (SLOVAK_LETTER.test(g)) hints.push(`gloss "${g}" has Slovak letters`);
    if (g.split(/\s+/u).length > 6) hints.push(`gloss "${g}" has more than six words`);
    if (/^\p{Lu}/u.test(g) && !/^I\b/u.test(g)) hints.push(`gloss "${g}" starts with a capital`);
    if (/^(?:a|an|the) /u.test(g) && pos === 'noun') hints.push(`noun gloss "${g}" has an article`);
  }
  if (new Set(glosses.map((g) => g.toLowerCase())).size < glosses.length)
    hints.push('the same gloss twice');
  return hints;
}

const glossesSpec: RouteSpec<GlossRequest, GlossAnswer> = {
  task: glossesTask,
  input: (user) => ({ words: JSON.parse(user) as GlossRequest['words'] }),
  show: (input) => [
    tab('key', 'aspect', 'most used forms'),
    ...input.words.map((w) => tab(w.key, w.aspect, (w.forms ?? []).join(' '))),
  ],
  async deep(_paths, pairs) {
    const out = new Map<string, ItemReport[]>();
    for (const p of pairs) {
      const pos = new Map(p.input.words.map((w) => [w.key, w.pos]));
      out.set(
        p.request.hash,
        p.output.items.map((it) => ({
          id: it.key,
          errors: [],
          hints: glossHints(pos.get(it.key) ?? '', it.glosses),
        })),
      );
    }
    return out;
  },
};

// --- content.sentences ------------------------------------------------------------------------

const ALLOWED_PUNCT = new Set([',', '.', '?', '!', '…', ':', ';', '-', '–']);

/** Every reason the sentence rules (stages/sentences/rules.ts) refuse a sentence, in words. */
export function sentenceErrors(a: Analysis, lex: Lexicon): string[] {
  const errors: string[] = [];
  if (a.words < MIN_WORDS || a.words > MAX_WORDS)
    errors.push(`${a.words} words, not ${MIN_WORDS} to ${MAX_WORDS}`);
  if (a.tokens.some((t) => t.t === 'num')) errors.push('a number in digits');
  if (!/^\p{Lu}/u.test(a.text)) errors.push('no capital letter at the start');
  if (!/[.?!…]$/u.test(a.text)) errors.push('no . ? ! or … at the end');
  const marks = a.tokens.filter((t) => t.t === 'punct' && !ALLOWED_PUNCT.has(t.text));
  if (marks.length > 0)
    errors.push(`punctuation not allowed: ${[...new Set(marks.map((t) => t.text))].join(' ')}`);
  let first = true;
  for (const t of a.tokens) {
    if (t.t !== 'word') continue;
    const initial = first;
    first = false;
    if (t.readings.length === 0) {
      const name = !initial && /^\p{Lu}/u.test(t.text);
      errors.push(
        `unknown word "${t.text}"${name ? ' (a capital inside a sentence is read as a name; names are not in the vocabulary)' : ''}`,
      );
      continue;
    }
    const ids = lemmasOf(t);
    if (ids.some((id) => lex.common(id))) continue;
    const what = ids
      .slice(0, 3)
      .map((id) => {
        const l = lex.lemmas.get(id);
        return `${l?.lemma} ${l?.pos}, ${l?.freqRank ? `rank ${l.freqRank}` : 'not ranked'}`;
      })
      .join('; ');
    errors.push(`rare word "${t.text}" (${what}): outside the ${lex.top} most common`);
  }
  return errors;
}

function candidatesOf(lex: Lexicon, ranked: readonly LexLemma[], item: SentenceItem): LexLemma[] {
  return ranked.filter(
    (l) =>
      l.lemma === item.lemma &&
      l.pos === item.pos &&
      (l.gender ?? undefined) === (item.gender ?? undefined) &&
      lex.isTopForm(l.id, item.form, item.tag),
  );
}

/** Why the requested form is not shown by the sentence, or null when it is. */
function targetError(a: Analysis, lex: Lexicon, lemmas: readonly LexLemma[], item: SentenceItem) {
  if (lemmas.length === 0) return `no ranked lemma "${item.lemma}" (${item.pos}) has this form`;
  for (const l of lemmas) {
    const t = requestedTarget(a, lex, { lemmaId: l.id, form: item.form, tag: item.tag });
    if (typeof t !== 'string') return null;
  }
  const f = item.form.toLowerCase();
  const tokens = a.tokens.filter((t) => t.t === 'word' && t.text.toLowerCase() === f);
  if (tokens.length === 0) return `the form "${item.form}" is not in the sentence`;
  const left = [
    ...new Set(
      tokens.flatMap((t) =>
        t.readings.map((r) => `${lex.lemmas.get(r.lemmaId)?.lemma} ${r.tag || '(no tag)'}`),
      ),
    ),
  ];
  return `"${item.form}" is in the sentence, but not as ${item.lemma} ${item.tag} (${item.formIs}): the words around it leave only ${left.join(', ') || 'no reading'}`;
}

async function sentenceLexicon(paths: Paths, texts: Iterable<string>): Promise<Lexicon> {
  const words = new Set<string>();
  for (const text of texts) for (const w of wordsIn(text)) words.add(w.toLowerCase());
  return loadLexicon(lexiconFiles(paths.build), SENTENCE_TOP, words);
}

const sentencesSpec: RouteSpec<SentenceRequest, SentenceAnswer> = {
  task: sentencesTask([]),
  input: (user) => ({ items: JSON.parse(user) as SentenceItem[] }),
  show: (input) => [
    tab('n', 'lemma', 'pos', 'form', 'tag', 'the form is', 'meaning'),
    ...input.items.map((i) =>
      tab(
        i.n,
        i.lemma,
        [i.pos, i.gender].filter(Boolean).join(' '),
        i.form,
        i.tag,
        i.formIs,
        (i.meaning ?? []).join('; '),
      ),
    ),
  ],
  async deep(paths, pairs) {
    const lex = await sentenceLexicon(
      paths,
      pairs.flatMap((p) => p.output.items.map((i) => i.sk)),
    );
    const ranked = lex.ranked();
    const seen = new Map<string, string>();
    const out = new Map<string, ItemReport[]>();
    for (const p of pairs) {
      const reports: ItemReport[] = [];
      for (const ans of p.output.items) {
        const item = p.input.items.find((i) => i.n === ans.n);
        if (!item) continue;
        const sk = ans.sk.trim();
        if (sk === SKIP) {
          reports.push({ id: String(ans.n), errors: [], hints: [], skipped: true });
          continue;
        }
        const a = analyse(sk, lex);
        const errors = sentenceErrors(a, lex);
        const target = targetError(a, lex, candidatesOf(lex, ranked, item), item);
        if (target) errors.push(target);
        const hints = grammarHints(sk, lex);
        const f = item.form.toLowerCase();
        if (a.tokens.filter((t) => t.t === 'word' && t.text.toLowerCase() === f).length > 1)
          hints.push(`the form "${item.form}" is in the sentence more than once`);
        if (/\[mock\]/u.test(ans.en)) errors.push('a mock translation');
        const where = `${p.request.hash.slice(0, 8)} n=${ans.n}`;
        const other = seen.get(sk);
        if (other) hints.push(`the same sentence as ${other}`);
        else seen.set(sk, where);
        reports.push({ id: String(ans.n), errors, hints });
      }
      out.set(p.request.hash, reports);
    }
    return out;
  },
};

// --- content.translate, content.review (sentences) --------------------------------------------

const translateSpec: RouteSpec<TranslateRequest, unknown> = {
  task: translateTask as BatchTask<TranslateRequest, unknown>,
  input: (user) => ({ items: JSON.parse(user) as TranslateRequest['items'] }),
  show: (input) => [tab('n', 'sk'), ...input.items.map((i) => tab(i.n, i.sk))],
};

const sentenceReviewSpec: RouteSpec<SentenceReviewRequest, unknown> = {
  task: sentenceReviewTask as BatchTask<SentenceReviewRequest, unknown>,
  input: (user) => ({ items: JSON.parse(user) as SentenceReviewRequest['items'] }),
  show: (input) => [
    tab('n', 'sk', 'en', 'lemma', 'form', 'the form is'),
    ...input.items.map((i) => tab(i.n, i.sk, i.en, i.lemma, i.form, i.formIs)),
  ],
};

// --- content.exercises ------------------------------------------------------------------------

interface ExercisePlan {
  rc: RuleContext;
  slots: Map<string, Slot>;
}

/**
 * The plan as the stage lays it out, long enough for the given slots: a larger `--per-bucket`
 * only adds slots at the end of each bucket.
 */
async function exercisePlan(paths: Paths, slotIds: readonly string[]): Promise<ExercisePlan> {
  const ctx = { paths };
  const last = Math.max(0, ...slotIds.map((s) => Number(s.split('/')[1]) || 0));
  const opts = {
    ...DEFAULT_PLAN,
    perBucket: Math.max(DEFAULT_PLAN.perBucket, Math.ceil((last + 1) / DEFAULT_PLAN.overshoot)),
    buckets: [],
  };
  const lessons = await readAuthoredLessons(authoredDir(ctx, 'lessons'));
  const triggerRows = await readTriggerRows(triggersOut(ctx));
  const m = await loadMorphology(defaultMorphFiles(paths), {
    formsFor: planLemmaFilter(lessons, triggerRows, opts),
    words: true,
  });
  const slots = planAll(m, lessons, planTriggers(m, triggerRows), opts);
  return {
    rc: { m, prepositions: prepositionSpellings(m), vocabularyLimit: opts.vocabularyLimit },
    slots: new Map(slots.map((s) => [s.slot, s])),
  };
}

const exercisesSpec: RouteSpec<ExerciseRequest, ExerciseAnswer> = {
  task: exercisesTask,
  input: (user) => JSON.parse(user) as ExerciseRequest,
  show: (input) => [
    `bucket: ${input.bucket}; vocabulary limit ${input.vocabularyLimit}; names: ${input.names.join(', ')}`,
    tab('trigger', 'kind', 'form to use', 'meaning'),
    ...input.triggers.map((t) => tab(t.id, t.kind, t.word, t.meaning)),
    tab('slot', 'trigger', 'gap', 'gap words'),
    ...input.items.map((i) =>
      tab(i.slot, i.trigger, i.gap, i.words.map((w) => `${w.form} < ${w.lemma}`).join(', ')),
    ),
  ],
  async deep(paths, pairs) {
    const plan = await exercisePlan(
      paths,
      pairs.flatMap((p) => p.input.items.map((i) => i.slot)),
    );
    const lex = await sentenceLexicon(
      paths,
      pairs.flatMap((p) => p.output.items.map((i) => i.sentenceSk)),
    );
    const out = new Map<string, ItemReport[]>();
    for (const p of pairs) {
      const reports: ItemReport[] = [];
      for (const c of p.output.items) {
        if (c.sentenceSk.trim() === SKIP) {
          reports.push({ id: c.slot, errors: [], hints: [], skipped: true });
          continue;
        }
        const slot = plan.slots.get(c.slot);
        if (!slot) {
          reports.push({ id: c.slot, errors: ['no such slot in the plan'], hints: [] });
          continue;
        }
        const checked = checkCandidate(c, slot, plan.rc);
        const hints = grammarHints(c.sentenceSk.trim(), lex);
        const n = wordsIn(c.sentenceSk).length;
        if (n < 4 || n > 10) hints.push(`${n} words; the prompt asks for 4 to 10`);
        reports.push({ id: c.slot, errors: checked.ok ? [] : checked.problems, hints });
      }
      out.set(p.request.hash, reports);
    }
    return out;
  },
  // A list is about every request of the buckets it names, so that a second `put` of a
  // shorter list takes back what the first one wrote.
  fill(input, items, used, all) {
    const bucketOf = (slot: string) => slot.split('/')[0];
    const bySlot = new Map<string, ExerciseAnswer['items'][number]>();
    for (const it of items as ExerciseAnswer['items'])
      if (typeof it?.slot === 'string') bySlot.set(it.slot, it);
    const buckets = new Set([...bySlot.keys()].map(bucketOf));
    if (!all && !input.items.some((i) => buckets.has(bucketOf(i.slot)))) return null;
    return {
      items: input.items.map((i) => {
        const own = bySlot.get(i.slot);
        if (own) used.add(own);
        return own ?? { slot: i.slot, sentenceSk: SKIP, sentenceEn: SKIP, gap: i.gap };
      }),
    };
  },
};

/**
 * The open slots of a bucket in one table, for a writer: its triggers once, then every slot.
 * A slot that can never pass the two case rule says so.
 */
export async function showBucket(paths: Paths, bucket: string): Promise<string[]> {
  const requests = (await openRequests(paths, 'exercises', exercisesTask.route)).filter((r) =>
    r.jobs.some((j) => j.startsWith(`${bucket}#`)),
  );
  if (requests.length === 0) return [`no open exercise request for the bucket "${bucket}"`];
  const inputs = requests.map((r) => exercisesSpec.input(r.user));
  const triggers = new Map(inputs.flatMap((i) => i.triggers).map((t) => [t.id, t]));
  const items = inputs.flatMap((i) => i.items).sort((a, b) => (a.slot < b.slot ? -1 : 1));
  const plan = await exercisePlan(
    paths,
    items.map((i) => i.slot),
  );
  const lines = [
    `bucket ${bucket}: ${inputs[0]?.bucket}; ${items.length} open slots in ${requests.length} requests`,
    `names the sentences may use: ${inputs[0]?.names.join(', ')}`,
    tab('trigger', 'kind', 'form to use', 'meaning'),
    ...[...triggers.values()].map((t) => tab(t.id, t.kind, t.word, t.meaning)),
    tab('slot', 'trigger', 'gap', 'base form', 'note'),
  ];
  for (const i of items) {
    const slot = plan.slots.get(i.slot);
    const never = slot
      ? checkCandidate(
          { slot: i.slot, sentenceSk: `${i.gap}.`, sentenceEn: 'x', gap: i.gap },
          slot,
          plan.rc,
        )
      : null;
    const twoCases =
      never && !never.ok ? never.problems.filter((p) => p.includes('is also a form of')) : [];
    lines.push(
      tab(
        i.slot,
        `${i.trigger} (${triggers.get(i.trigger)?.word})`,
        i.gap,
        i.words.map((w) => w.lemma).join(' '),
        twoCases.length > 0 ? `cannot pass: ${twoCases.join('; ')}` : '',
      ),
    );
  }
  return lines;
}

const exerciseReviewSpec: RouteSpec<ExerciseReviewRequest, unknown> = {
  task: exerciseReviewTask as BatchTask<ExerciseReviewRequest, unknown>,
  input: (user) => ({ items: JSON.parse(user) as ExerciseReviewRequest['items'] }),
  show: (input) => [
    tab('id', 'sentenceSk', 'sentenceEn', 'gap', 'expected', 'trigger'),
    ...input.items.map((i) => tab(i.id, i.sentenceSk, i.sentenceEn, i.gap, i.expected, i.trigger)),
  ],
};

// --- content.review (library) -----------------------------------------------------------------

const libraryReviewSpec: RouteSpec<LibraryReviewInput, unknown> = {
  task: libraryReviewTask as BatchTask<LibraryReviewInput, unknown>,
  input: (user) => JSON.parse(user) as LibraryReviewInput,
  show: (input) => [`${input.id}: ${input.title} (${input.level})`, '', input.body],
};

// --- reader.disambiguate and reader.gloss (analysis) ------------------------------------------
// Routes of apps/api that the `analysis` stage asks through the offline gateway (gateway.ts).
// The gateway accepts an answer on the same schema and the same problems as `lint`.

const readingLine = (r: DisambiguationInput['words'][number]['readings'][number]) =>
  `${r.i}: ${[r.lemma, r.pos, r.case, r.number, r.gender, r.verbTag].filter(Boolean).join(' ')}`;

const disambiguateSpec: RouteSpec<DisambiguationInput, Disambiguation> = {
  task: { schema: DisambiguationSchema, check: disambiguationProblems },
  input: (user) => JSON.parse(user) as DisambiguationInput,
  // Each sentence once, then its open words with their readings by index.
  show: (input) =>
    input.contexts.flatMap((context, c) => [
      `[${c}] ${context}`,
      ...input.words
        .filter((w) => w.context === c)
        .map((w) => tab(w.w, w.word, w.readings.map(readingLine).join(' | '))),
    ]),
};

const readerGlossSpec: RouteSpec<GlossInput, ReaderGlossAnswer> = {
  task: { schema: ReaderGlossAnswerSchema, check: glossProblems },
  input: (user) => JSON.parse(user) as GlossInput,
  show: (input) => [
    ...(input.sentence ? [`sentence: ${input.sentence}`] : []),
    tab('lemmaId', 'lemma', 'pos', 'gender', 'aspect'),
    ...input.lemmas.map((l) => tab(l.lemmaId, l.lemma, l.pos, l.gender, l.aspect)),
  ],
};

// --- content.audit.* (audit) ------------------------------------------------------------------
// One block of lines per item: what the learner sees, then what the entry claims.

const auditSentencesSpec: RouteSpec<AuditRequest<SentenceAuditItem>, unknown> = {
  task: auditSentencesTask as BatchTask<AuditRequest<SentenceAuditItem>, unknown>,
  input: (user) => ({ items: JSON.parse(user) as SentenceAuditItem[] }),
  show: (input) =>
    input.items.flatMap((i) => [
      `[${i.n}] ${i.sk}`,
      `     ${i.en}`,
      ...i.teaches.map(
        (t) =>
          `     teaches: ${t.form} = ${t.formIs} of ${t.lemma} (${[t.pos, t.gender].filter(Boolean).join(' ')})${t.meaning ? `, meaning: ${t.meaning.join('; ')}` : ''}`,
      ),
      `     source: ${i.source}`,
    ]),
};

const auditExercisesSpec: RouteSpec<AuditRequest<ExerciseAuditItem>, unknown> = {
  task: auditExercisesTask as BatchTask<AuditRequest<ExerciseAuditItem>, unknown>,
  input: (user) => ({ items: JSON.parse(user) as ExerciseAuditItem[] }),
  show: (input) =>
    input.items.flatMap((i) => [
      `[${i.n}] ${i.kind}: ${i.sk}`,
      `     ${i.en}`,
      `     answer: ${i.answer} = ${i.asks} of ${i.cue}`,
      ...(i.trigger ? [`     trigger: ${i.trigger}`] : []),
      ...(i.options
        ? [
            `     options: ${i.options.map((o) => `${o.text}${o.correct ? ' (right)' : ''}`).join(' | ')}`,
          ]
        : []),
    ]),
};

const auditGlossesSpec: RouteSpec<AuditRequest<GlossAuditItem>, unknown> = {
  task: auditGlossesTask as BatchTask<AuditRequest<GlossAuditItem>, unknown>,
  input: (user) => ({ items: JSON.parse(user) as GlossAuditItem[] }),
  show: (input) =>
    input.items.flatMap((i) => [
      `[${i.n}] ${i.lemma} (${[i.pos, i.gender, i.aspect].filter(Boolean).join(' ')})`,
      ...i.glosses.map((g, k) => `     ${k + 1}. ${g}`),
    ]),
};

/** Every route of every stage with a model fill. */
export const OFFLINE_ROUTES: Record<string, Record<string, AnySpec>> = {
  dict: { 'content.glosses': glossesSpec },
  sentences: {
    'content.translate': translateSpec,
    'content.sentences': sentencesSpec,
    'content.review': sentenceReviewSpec,
  },
  exercises: {
    'content.exercises': exercisesSpec,
    'content.exercises.review': exerciseReviewSpec,
  },
  library: { 'content.review': libraryReviewSpec },
  analysis: { 'reader.disambiguate': disambiguateSpec, 'reader.gloss': readerGlossSpec },
  audit: {
    'content.audit.sentences': auditSentencesSpec,
    'content.audit.exercises': auditExercisesSpec,
    'content.audit.glosses': auditGlossesSpec,
  },
};

export function specOf(stage: string, route: string): AnySpec {
  const spec = OFFLINE_ROUTES[stage]?.[route];
  if (!spec)
    throw new Error(
      `no offline route "${route}" in stage "${stage}". Known: ${Object.entries(OFFLINE_ROUTES)
        .map(([s, r]) => `${s}: ${Object.keys(r).join(', ')}`)
        .join('; ')}`,
    );
  return spec;
}

/** The open requests of a route, by hash. */
export async function openRequests(
  paths: Paths,
  stage: string,
  route: string,
): Promise<OfflineRequest[]> {
  const dir = offlineRequestsDir(paths, stage);
  const out: OfflineRequest[] = [];
  for (const f of await listFiles(`${dir}/${route}`))
    if (f.endsWith('.json'))
      out.push(JSON.parse(await readFile(`${dir}/${route}/${f}`, 'utf8')) as OfflineRequest);
  return out.sort((a, b) => (a.hash < b.hash ? -1 : 1));
}

/**
 * The requests the given words name (all when none is given). A word is the start of one
 * request's hash, a job id (`g12`, `acc.sg.f#3`) or what stands before the `#` of job ids
 * (`acc.sg.f`: every request of the bucket).
 */
export function pick(requests: readonly OfflineRequest[], names: readonly string[]) {
  if (names.length === 0) return [...requests];
  const out = new Map<string, OfflineRequest>();
  for (const name of names) {
    const byJob = requests.filter((r) =>
      r.jobs.some((j) => j === name || j.startsWith(`${name}#`)),
    );
    const byHash = requests.filter((r) => r.hash.startsWith(name));
    if (byJob.length === 0 && byHash.length !== 1)
      throw new Error(`"${name}" names ${byHash.length} open requests, not one, and no job`);
    for (const r of byJob.length > 0 ? byJob : byHash) out.set(r.hash, r);
  }
  return [...out.values()].sort((a, b) => (a.hash < b.hash ? -1 : 1));
}

export const answerPath = (paths: Paths, stage: string, route: string, hash: string) =>
  offlinePath(offlineAnswersDir(paths, stage), route, hash);

/** A request as a writer reads it: where the answer goes, then the items. */
export function showRequest(paths: Paths, stage: string, request: OfflineRequest): string {
  const spec = specOf(stage, request.route);
  return [
    `# request ${request.hash}`,
    `# answer file: ${answerPath(paths, stage, request.route, request.hash)}`,
    ...spec.show(spec.input(request.user)),
  ].join('\n');
}

/** Checks the answer files of the given requests as the runner and the stage will. */
export async function lintRequests(
  paths: Paths,
  stage: string,
  route: string,
  requests: readonly OfflineRequest[],
): Promise<RequestReport[]> {
  const spec = specOf(stage, route);
  const reports = new Map<string, RequestReport>();
  const pairs: Pair<unknown, unknown>[] = [];
  for (const request of requests) {
    const path = answerPath(paths, stage, route, request.hash);
    if (!existsSync(path)) {
      reports.set(request.hash, { hash: request.hash, state: 'missing', items: [] });
      continue;
    }
    const input = spec.input(request.user);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      reports.set(request.hash, {
        hash: request.hash,
        state: 'invalid',
        problem: `not JSON: ${(e as Error).message}`,
        items: [],
      });
      continue;
    }
    const v = validateAnswer(spec.task, input, value);
    if (!v.ok) {
      reports.set(request.hash, {
        hash: request.hash,
        state: 'invalid',
        problem: v.reason,
        items: [],
      });
      continue;
    }
    reports.set(request.hash, { hash: request.hash, state: 'checked', items: [] });
    pairs.push({ request, input, output: v.output });
  }
  if (spec.deep && pairs.length > 0) {
    const deep = await spec.deep(paths, pairs);
    for (const [hash, items] of deep) (reports.get(hash) as RequestReport).items = items;
  }
  return requests.map((r) => reports.get(r.hash) as RequestReport);
}

/**
 * Writes answer files from a writer's own list of items (one JSON object per line): every
 * open request the list is about (for exercises: every request of its buckets) gets its
 * answer, with SKIP for the items the list leaves out. Returns the hashes written; an item
 * no open request asks for is an error.
 */
export async function putItems(
  paths: Paths,
  stage: string,
  route: string,
  file: string,
): Promise<string[]> {
  const spec = specOf(stage, route);
  if (!spec.fill) throw new Error(`"put" does not know the route "${route}" of "${stage}"`);
  const items: unknown[] = [];
  for (const [n, line] of (await readFile(file, 'utf8')).split('\n').entries()) {
    if (line.trim() === '') continue;
    try {
      items.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`${file}:${n + 1}: not JSON: ${(e as Error).message}`);
    }
  }
  const used = new Set<unknown>();
  const written: string[] = [];
  const answers: { path: string; text: string }[] = [];
  for (const request of await openRequests(paths, stage, route)) {
    const answer = spec.fill(spec.input(request.user), items, used, false);
    if (!answer) continue;
    answers.push({
      path: answerPath(paths, stage, route, request.hash),
      text: `${JSON.stringify(answer, null, 1)}\n`,
    });
    written.push(request.hash);
  }
  const unused = items.filter((i) => !used.has(i));
  if (unused.length > 0)
    throw new Error(
      `${unused.length} items of ${file} are asked by no open request (or stand twice), nothing written: ${unused
        .slice(0, 5)
        .map((i) => JSON.stringify(i).slice(0, 80))
        .join(' | ')}`,
    );
  for (const a of answers) await writeFileAtomic(a.path, a.text);
  return written;
}

/** Writes an answer of SKIPs for every given request that has no answer file. */
export async function skipRequests(
  paths: Paths,
  stage: string,
  route: string,
  requests: readonly OfflineRequest[],
): Promise<string[]> {
  const spec = specOf(stage, route);
  if (!spec.fill) throw new Error(`"skip" does not know the route "${route}" of "${stage}"`);
  const written: string[] = [];
  for (const request of requests) {
    const path = answerPath(paths, stage, route, request.hash);
    if (existsSync(path)) continue;
    const answer = spec.fill(spec.input(request.user), [], new Set(), true);
    await writeFileAtomic(path, `${JSON.stringify(answer, null, 1)}\n`);
    written.push(request.hash);
  }
  return written;
}

/** How many items pass, fail and are left out, over all reports. */
export function tally(reports: readonly RequestReport[]) {
  const items = reports.flatMap((r) => r.items);
  const rejected = items.filter((i) => i.errors.length > 0).length;
  const skipped = items.filter((i) => i.skipped).length;
  return { pass: items.length - rejected - skipped, rejected, skipped };
}

/** The report as text: one line per request, then one per item with a problem or a hint. */
export function renderLint(reports: readonly RequestReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    const errors = r.items.filter((i) => i.errors.length > 0).length;
    const hints = r.items.filter((i) => i.hints.length > 0).length;
    const skipped = r.items.filter((i) => i.skipped).length;
    if (r.state === 'missing') lines.push(`${r.hash}: NO ANSWER FILE`);
    else if (r.state === 'invalid') lines.push(`${r.hash}: REFUSED WHOLE: ${r.problem}`);
    else
      lines.push(
        `${r.hash}: ${errors === 0 ? 'ok' : `${errors} items REJECTED`}${hints > 0 ? `, ${hints} with hints` : ''}${skipped > 0 ? `, ${skipped} left out (SKIP)` : ''}`,
      );
    for (const i of r.items) {
      for (const e of i.errors) lines.push(`  ${i.id}  ERROR  ${e}`);
      for (const h of i.hints) lines.push(`  ${i.id}  hint   ${h}`);
    }
  }
  return lines.join('\n');
}

/** Hints for the sentences of a review request, for the reviewer: grammar and the target's readings. */
export async function reviewHints(
  paths: Paths,
  stage: string,
  request: OfflineRequest,
): Promise<string[]> {
  if (stage !== 'sentences' && stage !== 'exercises') return [];
  const items: { id: string; sk: string; form?: string }[] =
    stage === 'sentences'
      ? (JSON.parse(request.user) as SentenceReviewRequest['items']).map((i) => ({
          id: String(i.n),
          sk: i.sk,
          form: i.form,
        }))
      : (JSON.parse(request.user) as ExerciseReviewRequest['items']).map((i) => ({
          id: i.id,
          sk: i.sentenceSk,
        }));
  const lex = await sentenceLexicon(
    paths,
    items.map((i) => i.sk),
  );
  const lines: string[] = [];
  for (const i of items) {
    for (const h of grammarHints(i.sk, lex)) lines.push(`${i.id}\thint\t${h}`);
    if (!i.form) continue;
    const a = analyse(i.sk, lex);
    const f = i.form.toLowerCase();
    for (const t of a.tokens)
      if (t.t === 'word' && t.text.toLowerCase() === f && t.readings.length > 1)
        lines.push(
          `${i.id}\treadings\t${t.text}: ${[...new Set(t.readings.map((r) => `${lex.lemmas.get(r.lemmaId)?.lemma} ${r.tag}`))].join(', ')}`,
        );
  }
  return lines;
}

const lemmaLine = (l: LexLemma | undefined) =>
  l
    ? `${l.lemma} (${[l.pos, l.gender].filter(Boolean).join(' ')}), ${l.freqRank ? `rank ${l.freqRank}` : 'not ranked'}`
    : 'unknown lemma';

/** What the morphology knows of written forms: each lemma with its rank and the form's tags. */
export async function describeWords(paths: Paths, forms: readonly string[]): Promise<string[]> {
  const lex = await loadLexicon(
    lexiconFiles(paths.build),
    SENTENCE_TOP,
    new Set(forms.map((f) => f.toLowerCase())),
  );
  const lines: string[] = [];
  for (const form of forms) {
    const readings = lex.byLower.get(form.toLowerCase()) ?? [];
    if (readings.length === 0) {
      lines.push(`${form}: not a known form`);
      continue;
    }
    const byLemma = new Map<number, string[]>();
    for (const r of readings)
      byLemma.set(r.lemmaId, [...(byLemma.get(r.lemmaId) ?? []), r.tag || '(no tag)']);
    const ids = [...byLemma.keys()].sort(
      (a, b) => (lex.rankOf(a) ?? Infinity) - (lex.rankOf(b) ?? Infinity) || a - b,
    );
    lines.push(
      `${form}: ${ids.some((id) => lex.common(id)) ? 'allowed' : `NOT within the ${SENTENCE_TOP} most common`}`,
    );
    for (const id of ids)
      lines.push(`  ${lemmaLine(lex.lemmas.get(id))}: ${[...new Set(byLemma.get(id))].join(' ')}`);
  }
  return lines;
}

/** Every form of the lemmas written this way that rank within the most common, by tag. */
export async function describeForms(paths: Paths, lemmas: readonly string[]): Promise<string[]> {
  const lex = await loadLexicon(lexiconFiles(paths.build), SENTENCE_TOP, new Set());
  const lines: string[] = [];
  for (const text of lemmas) {
    const found = lex.ranked().filter((l) => l.lemma === text);
    if (found.length === 0) {
      lines.push(`${text}: no lemma within the ${SENTENCE_TOP} most common is written this way`);
      continue;
    }
    for (const l of found) {
      const byTag = new Map<string, Set<string>>();
      for (const readings of lex.byLower.values())
        for (const r of readings)
          if (r.lemmaId === l.id)
            byTag.set(r.tag, (byTag.get(r.tag) ?? new Set<string>()).add(r.form));
      lines.push(lemmaLine(l));
      for (const tag of [...byTag.keys()].sort())
        lines.push(`  ${tag || '(no tag)'}\t${[...(byTag.get(tag) ?? [])].join(', ')}`);
    }
  }
  return lines;
}
