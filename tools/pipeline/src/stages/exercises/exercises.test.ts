import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExerciseRow, LessonRow } from '@app/contracts';
import { MINI_DIR } from '@app/testkit/mini';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readJsonl, writeJsonl } from '../../lib/files';
import { LemmaRegistry } from '../../lib/registry';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { validateSet } from '../../lib/validate';
import { MockBatchClient } from '../../model';
import { STAGES } from '..';
import {
  lessonsOut,
  lessonsStage,
  MIN_CHECKPOINT,
  readAuthoredLessons,
  readLessonRows,
} from '../lessons';
import { readTriggerRows, triggersOut, triggersStage } from '../triggers';
import { findLemma, formsWith, loadMorphology, type Morphology } from '../triggers/morphology';
import { allChecks } from '../validate';
import { exerciseFormsCheck, exercisesStage, readExercises, runExercises } from '.';
import {
  DEFAULT_PLAN,
  type PlanTrigger,
  planBucket,
  planTriggers,
  prepositionSpellings,
  type Slot,
} from './plan';
import { type ExerciseRequest, exercisesTask, type ReviewRequest } from './prompts';
import { checkCandidate, type RuleContext } from './rules';

const AUTHORED = fileURLToPath(new URL('../../../../../content/authored', import.meta.url));
const MINI = {
  lemmas: join(MINI_DIR, 'lemmas.jsonl'),
  forms: join(MINI_DIR, 'forms.jsonl'),
  complete: false,
};

type Row = Record<string, unknown>;
async function rows<T = Row>(path: string): Promise<T[]> {
  const out: T[] = [];
  for await (const r of readJsonl<T>(path)) out.push(r);
  return out;
}

async function miniRegistry(): Promise<LemmaRegistry> {
  const entries: [number, string][] = [];
  for await (const l of readJsonl<{ id: number; key: string }>(join(MINI_DIR, 'lemmas.jsonl')))
    entries.push([l.id, l.key]);
  return new LemmaRegistry(entries);
}

/** A temp root with the authored content and the triggers and lessons built on the mini dataset. */
async function c4Root(): Promise<TempRoot> {
  const t = await tempRoot();
  await cp(AUTHORED, join(t.paths.content, 'authored'), { recursive: true });
  await runStage(triggersStage, t.ctx({ morph: MINI_DIR }));
  await runStage(lessonsStage, t.ctx({ morph: MINI_DIR }));
  return t;
}

const exercisesOut = (t: TempRoot) => join(t.paths.build, 'exercises', 'exercises.jsonl');
const userInput = <T>(params: { messages: { content: unknown }[] }): T =>
  JSON.parse(String(params.messages[0]?.content)) as T;

describe('the exercises stage with a mock fill on the mini dataset', () => {
  let t: TempRoot;
  let bank: ExerciseRow[];
  beforeAll(async () => {
    t = await c4Root();
    await runStage(exercisesStage, t.ctx({ morph: MINI_DIR, fill: 'mock' }));
    bank = await rows<ExerciseRow>(exercisesOut(t));
  }, 120_000);
  afterAll(() => t.remove());

  it('writes reviewed exercises with hash ids, kinds, difficulties and lessons', () => {
    expect(bank.length).toBeGreaterThan(100);
    expect(new Set(bank.map((r) => r.id)).size).toBe(bank.length);
    for (const r of bank) {
      expect(r.id).toMatch(/^ex-[0-9a-f]{10}$/u);
      expect(r.source).toBe('generated');
      expect(r.verified).toBe(false);
      expect(r.flags).toMatchObject({ review: 'pass', generation: { route: 'content.exercises' } });
      expect(r.difficulty).toBeGreaterThanOrEqual(0);
      expect(r.difficulty).toBeLessThanOrEqual(1);
      expect(r.sentenceSk.slice(r.target.start, r.target.end).toLowerCase()).toBe(
        (r.target.answers[0] as string).toLowerCase(),
      );
    }
    const kinds = new Set(bank.map((r) => r.kind));
    expect(kinds).toEqual(new Set(['cloze', 'choice_form', 'choice_meaning']));
    // Phrase exercises: an adjective and its noun in one gap.
    expect(bank.some((r) => r.target.lemmaIds.length === 2)).toBe(true);
    const lessons = new Set(bank.map((r) => r.lessonId));
    expect(lessons).toContain('mixed');
    expect(lessons).toContain('acc-sg');
  });

  it('builds wrong options from other real forms of the target word', () => {
    const choice = bank.filter((r) => r.kind === 'choice_form');
    expect(choice.length).toBeGreaterThan(0);
    for (const r of choice) {
      const opts = r.options ?? [];
      expect(opts.filter((o) => o.correct)).toHaveLength(1);
      expect(new Set(opts.map((o) => o.text)).size).toBe(opts.length);
      expect(opts.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('fills every lesson with five steps in order and a checkpoint of at least 8 exercises', async () => {
    const merged = await rows<{ id: string; steps: LessonRow['steps'] }>(
      join(t.paths.build, 'exercises', 'lessons.jsonl'),
    );
    const byId = new Map(bank.map((r) => [r.id, r]));
    expect(merged).toHaveLength(9);
    for (const l of merged) {
      expect(l.steps.map((s) => s.kind)).toEqual([
        'explain',
        'triggers',
        'comprehension',
        'production',
        'checkpoint',
      ]);
      const checkpoint = l.steps[4]?.content as { exerciseIds: string[] };
      expect(checkpoint.exerciseIds.length, l.id).toBeGreaterThanOrEqual(MIN_CHECKPOINT);
      for (const s of l.steps.slice(2)) {
        const ids = (s.content as { exerciseIds: string[] }).exerciseIds;
        expect(ids.length, `${l.id} ${s.kind}`).toBeGreaterThan(0);
        for (const id of ids) expect(byId.get(id)?.lessonId, `${l.id} ${id}`).toBe(l.id);
      }
      const comprehension = l.steps[2]?.content as { exerciseIds: string[] };
      for (const id of comprehension.exerciseIds) expect(byId.get(id)?.kind).not.toBe('cloze');
    }
  });

  it('passes validate together with the rest of the mini dataset', async () => {
    const dir = join(t.root, 'set');
    await cp(MINI_DIR, dir, { recursive: true });
    const triggers = await readTriggerRows(triggersOut(t.ctx()));
    const lessons = await readLessonRows(lessonsOut(t.ctx()));
    const steps = new Map(
      (
        await rows<{ id: string; steps: LessonRow['steps'] }>(
          join(t.paths.build, 'exercises', 'lessons.jsonl'),
        )
      ).map((l) => [l.id, l.steps]),
    );
    const merged = lessons.map((l) => ({ ...l, steps: steps.get(l.id) ?? l.steps }));
    const patterns = await rows(join(t.paths.build, 'lessons', 'patterns.jsonl'));
    await writeJsonl(join(dir, 'triggers.jsonl'), triggers);
    await writeJsonl(join(dir, 'lessons.jsonl'), merged);
    await writeJsonl(join(dir, 'patterns.jsonl'), patterns);
    await writeJsonl(join(dir, 'exercises.jsonl'), bank);
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    Object.assign(manifest.counts, {
      triggers: triggers.length,
      lessons: merged.length,
      patterns: patterns.length,
      exercises: bank.length,
    });
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const r = await validateSet(dir, allChecks(STAGES), { registry: await miniRegistry() });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    // Every C4 check ran on the set.
    for (const id of ['c4.trigger-cases', 'c4.patterns', 'c4.lessons', 'c4.exercises'])
      expect(Object.keys(r.ms)).toContain(id);
  });

  it('keeps the bank on a second run without asking the model again', async () => {
    const before = await readFile(exercisesOut(t), 'utf8');
    await runStage(exercisesStage, t.ctx({ morph: MINI_DIR, fill: 'mock' }), { force: true });
    expect(await readFile(exercisesOut(t), 'utf8')).toBe(before);
  });

  it('reports the dry-run requests and cost without writing exercises', async () => {
    const t2 = await c4Root();
    try {
      await runStage(exercisesStage, t2.ctx({ morph: MINI_DIR, fill: 'dry-run' }));
      const report = JSON.parse(
        await readFile(join(t2.paths.build, 'exercises', 'report.json'), 'utf8'),
      );
      expect(report.generation.estimate.requests).toBeGreaterThan(0);
      expect(report.review.estimate.requests).toBeGreaterThan(0);
      expect(report.exercises).toBe(0);
      expect(existsSync(join(t2.paths.build, 'exercises', 'exercises.mock.jsonl'))).toBe(false);
    } finally {
      await t2.remove();
    }
  });
});

describe('the rule checks', () => {
  let m: Morphology;
  let rc: RuleContext;
  let slots: Slot[];
  let triggers: Map<string, PlanTrigger>;
  beforeAll(async () => {
    const t = await c4Root();
    try {
      const lessons = await readAuthoredLessons(join(AUTHORED, 'lessons'));
      const triggerRows = await readTriggerRows(triggersOut(t.ctx()));
      m = await loadMorphology(MINI, { formsFor: () => true, words: true });
      rc = { m, prepositions: prepositionSpellings(m), vocabularyLimit: 3000 };
      triggers = planTriggers(m, triggerRows);
      const gen = lessons.find((l) => l.id === 'gen-sg');
      if (!gen) throw new Error('no lesson gen-sg');
      slots = planBucket(m, gen, 'gen.sg.n', triggers, DEFAULT_PLAN);
    } finally {
      await t.remove();
    }
  });

  const slotOf = (pred: (s: Slot) => boolean) => {
    const s = slots.find(pred);
    if (!s) throw new Error('no such slot');
    return s;
  };

  it('accept a sentence with the right form after its trigger', () => {
    const s = slotOf((x) => x.words.length === 1 && x.trigger.id === 'prep-do');
    const r = checkCandidate(
      { slot: s.slot, sentenceSk: `Idem do ${s.gap}.`, sentenceEn: 'I go.', gap: s.gap },
      s,
      rc,
    );
    expect(r).toMatchObject({ ok: true });
  });

  it('reject an answer in the wrong case', () => {
    const s = slotOf((x) => x.words.length === 1 && x.trigger.id === 'prep-do');
    const lemma = m.lemmas.get(s.words[0]?.lemmaId as number);
    const loc = formsWith(m.forms.get(lemma?.id as number), 's6')[0] as string;
    const r = checkCandidate(
      { slot: s.slot, sentenceSk: `Idem do ${loc}.`, sentenceEn: 'I go.', gap: loc },
      s,
      rc,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problems.join('\n')).toMatch(
        new RegExp(`"${loc}" is s6 of ${lemma?.lemma}, not s2`, 'u'),
      );
  });

  it('allow a listed name beyond the vocabulary limit, and no other rare word', () => {
    const s = slotOf((x) => x.words.length === 1 && x.trigger.id === 'prep-do');
    // Bratislava ranks 71 and kamarát 54 in the mini dataset: both lie beyond a limit of 50.
    const strict: RuleContext = { ...rc, vocabularyLimit: 50 };
    const problems = (sk: string) => {
      const r = checkCandidate(
        { slot: s.slot, sentenceSk: sk, sentenceEn: 'x', gap: s.gap },
        s,
        strict,
      );
      return r.ok ? '' : r.problems.join('\n');
    };
    expect(problems(`Bratislava ide do ${s.gap}.`)).not.toMatch(/rare word/u);
    expect(problems(`Kamarát ide do ${s.gap}.`)).toMatch(/rare word "Kamarát" \(rank 54\)/u);
  });

  it('reject a gap that is not a form, a missing gap, a far trigger and an unknown word', () => {
    const s = slotOf((x) => x.words.length === 1 && x.trigger.id === 'prep-do');
    const problems = (sk: string, gap: string) => {
      const r = checkCandidate({ slot: s.slot, sentenceSk: sk, sentenceEn: 'x', gap }, s, rc);
      return r.ok ? [] : r.problems.join('\n');
    };
    expect(problems('Idem do mestaa.', 'mestaa')).toMatch(/"mestaa" is not a form of/u);
    expect(problems('Idem do domu.', s.gap)).toMatch(/is not in the sentence/u);
    expect(problems(`Do dnes ${s.gap}.`, s.gap)).toMatch(/does not stand right before the gap/u);
    expect(problems(`Idem do ${s.gap} zajtrajškom.`, s.gap)).toMatch(/unknown word "zajtrajškom"/u);
    expect(problems(`Idem do ${s.gap} 5.`, s.gap)).toMatch(/digits/u);
  });

  it('reject a verb gap that a preposition governs', async () => {
    const lessons = await readAuthoredLessons(join(AUTHORED, 'lessons'));
    const acc = lessons.find((l) => l.id === 'acc-sg');
    if (!acc) throw new Error('no lesson acc-sg');
    const s = planBucket(m, acc, 'acc.sg.n', triggers, DEFAULT_PLAN).find(
      (x) => x.trigger.id === 'verb-vidiet' && x.words.length === 1,
    );
    if (!s) throw new Error('no vidieť slot');
    const r = checkCandidate(
      { slot: s.slot, sentenceSk: `Vidím na ${s.gap}.`, sentenceEn: 'x', gap: s.gap },
      s,
      rc,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join('\n')).toMatch(/the preposition "na" governs the gap/u);
  });

  it('reject a form that a two-case preposition leaves open', async () => {
    const lessons = await readAuthoredLessons(join(AUTHORED, 'lessons'));
    const loc = lessons.find((l) => l.id === 'loc-sg');
    if (!loc) throw new Error('no lesson loc-sg');
    const base = planBucket(m, loc, 'loc.sg.m_inan', triggers, DEFAULT_PLAN).find(
      (x) => x.trigger.id === 'prep-na-loc' && x.words.length === 1,
    );
    const den = findLemma(m, 'deň', ['noun'], 'm_inan');
    if (!base || !den) throw new Error('no na slot or no deň');
    expect(base.trigger.otherCases).toEqual(['acc']);
    // "dni" is the locative singular and the accusative plural of deň.
    const s: Slot = {
      ...base,
      words: [{ lemmaId: den.id, lemma: 'deň', role: 'noun', tag: 's6', forms: ['dni'] }],
      gap: 'dni',
    };
    const r = checkCandidate(
      { slot: s.slot, sentenceSk: 'Na dni.', sentenceEn: 'x', gap: 'dni' },
      s,
      rc,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(['"dni" is also a form of the acc, which na takes too']);
  });
});

describe('rejections in the stage', () => {
  it('drops sentences whose gap is in the wrong case, and those the review rejects', async () => {
    const t = await c4Root();
    try {
      const m = await loadMorphology(MINI, { formsFor: () => true, words: true });
      // The writer puts every single noun of the bucket in the locative instead of the genitive.
      const generateClient = new MockBatchClient((params) => {
        const input = userInput<ExerciseRequest>(params as never);
        const answer = exercisesTask.mock?.(input) ?? { items: [] };
        for (const item of answer.items) {
          const asked = input.items.find((i) => i.slot === item.slot);
          if (asked?.words.length !== 1) continue;
          const l = findLemma(m, asked.words[0]?.lemma as string, ['noun'], 'n');
          const loc = l ? formsWith(m.forms.get(l.id), 's6')[0] : undefined;
          if (!loc) continue;
          const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
          // A question's answer starts with a capital: "Koho? Mesta."
          const [from, to] = item.sentenceSk.includes(item.gap)
            ? [item.gap, loc]
            : [cap(item.gap), cap(loc)];
          item.sentenceSk = item.sentenceSk.replace(from, to);
          item.gap = to;
        }
        return { json: answer };
      });
      // The review turns down every phrase.
      const reviewClient = new MockBatchClient((params) => {
        const input = userInput<ReviewRequest['items']>(params as never);
        return {
          json: {
            items: input.map((i) => ({
              id: i.id,
              natural: !i.gap.includes(' '),
              translationCorrect: true,
              onlyThisCase: true,
              ...(i.gap.includes(' ') ? { problem: 'stilted' } : {}),
            })),
          },
        };
      });
      await runExercises(t.ctx({ morph: MINI_DIR, fill: 'mock', buckets: 'gen.sg.n' }), {
        generateClient,
        reviewClient,
      });
      const report = JSON.parse(
        await readFile(join(t.paths.build, 'exercises', 'report.json'), 'utf8'),
      );
      const rules = report.rejections.filter((r: { stage: string }) => r.stage === 'rules');
      const review = report.rejections.filter((r: { stage: string }) => r.stage === 'review');
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) expect(r.reason).toMatch(/" is [sp0-9 ]*s6[sp0-9 ]* of \S+, not s2/u);
      expect(review.length).toBeGreaterThan(0);
      for (const r of review) expect(r.reason).toBe('stilted');
      // Only pronouns could be left; the bucket's nouns and phrases are all gone.
      const bank = await readExercises(join(t.paths.build, 'exercises', 'exercises.mock.jsonl'));
      for (const r of bank) expect(r.target.answers[0]).not.toMatch(/ /u);
      for (const r of bank) expect(r.case).toBe('gen');
      expect(
        bank.every((r) => !/meste|kine|múzeu|námestí|srdci|dievčati/u.test(r.sentenceSk)),
      ).toBe(true);
    } finally {
      await t.remove();
    }
  }, 120_000);
});

describe('the exercises check in validate', () => {
  it('reports an answer in the wrong case and an option that is not a real form', async () => {
    const t = await c4Root();
    try {
      await runStage(exercisesStage, t.ctx({ morph: MINI_DIR, fill: 'mock', buckets: 'gen.sg.n' }));
      const bank = await rows<ExerciseRow>(exercisesOut(t));
      const dir = join(t.root, 'set');
      await cp(MINI_DIR, dir, { recursive: true });
      await writeJsonl(join(dir, 'exercises.jsonl'), bank);
      expect((await validateSet(dir, [exerciseFormsCheck])).issues).toEqual([]);

      const cloze = bank.find(
        (r) => r.kind === 'cloze' && r.target.lemmaIds.length === 1,
      ) as ExerciseRow;
      const choice = bank.find((r) => r.kind === 'choice_form') as ExerciseRow;
      const m = await loadMorphology(MINI, { formsFor: () => true });
      const loc = formsWith(m.forms.get(cloze.target.lemmaIds[0] as number), 's6')[0] as string;
      const broken = bank.map((r) => {
        if (r.id === cloze.id) return { ...r, target: { ...r.target, answers: [loc] } };
        if (r.id === choice.id)
          return {
            ...r,
            options: (r.options ?? []).map((o, i) =>
              o.correct || i > 1 ? o : { ...o, text: 'mestoš' },
            ),
          };
        return r;
      });
      await writeJsonl(join(dir, 'exercises.jsonl'), broken);
      const issues = (await validateSet(dir, [exerciseFormsCheck])).issues.map((i) => i.message);
      expect(issues).toContainEqual(
        expect.stringMatching(
          new RegExp(`\\(${cloze.id}\\): answer "${loc}" is s6 of lemma \\d+, not gen sg`, 'u'),
        ),
      );
      expect(issues).toContainEqual(
        expect.stringMatching(
          new RegExp(`\\(${choice.id}\\): option "mestoš" is not a form of lemma \\d+`, 'u'),
        ),
      );
    } finally {
      await t.remove();
    }
  }, 120_000);
});
