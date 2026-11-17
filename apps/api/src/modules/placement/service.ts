// Logic of the placement module. Owner: B6. It takes ports and a transaction and knows
// nothing about HTTP.
//
// A run lives in `app.placement`: `items` holds every item shown with its key and the answer
// given, so the server grades every round and the items sent out carry no answers. Rounds
// depend only on the run id and the answers (seeded randomness), and an answered round
// replayed with the same answers returns what it returned the first time.
import type {
  PlacementAnswersResult,
  PlacementResult,
  PlacementRun,
  RequestOutput,
} from '@app/contracts';
import { buildFormMap, diagnoseForm, errorTypeFor, tagOf } from '@app/ling';
import { conflict, notFound, validationFailed } from '../../platform/errors';
import type { AttemptRecord, Clock, IdGenerator, Ports, Tx } from '../../ports';
import {
  buildCaseItems,
  buildResult,
  buildVocabRound,
  CASE_ROUND,
  type Given,
  isCase,
  isVocab,
  MAX_RANK,
  pickCaseExercises,
  type StoredCase,
  type StoredItem,
  sameGiven,
  VOCAB_ROUNDS,
} from './items';
import * as repo from './repo';

export interface PlacementDeps {
  ports: Ports;
  clock: Clock;
  ids: IdGenerator;
}

function currentRound(items: readonly StoredItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.round), 0);
}

function roundOf(items: readonly StoredItem[], round: number) {
  const list = items.filter((i) => i.round === round).map((i) => i.item);
  return list.length > 0 ? { round, items: list } : undefined;
}

export function toRun(run: repo.RunRow): PlacementRun {
  const out: PlacementRun = { id: run.id, status: run.status };
  if (run.status === 'active') {
    const r = roundOf(run.items, currentRound(run.items));
    if (r) out.round = r;
  }
  if (run.result) out.result = run.result;
  return out;
}

export async function get(tx: Tx, id: string): Promise<PlacementRun> {
  const run = await repo.getRun(tx, id);
  if (!run) throw notFound();
  return toRun(run);
}

/** `POST /placement`: a new run with its first round, or the stored run for a repeated id. */
export async function start(
  tx: Tx,
  deps: PlacementDeps,
  userId: string,
  id: string,
): Promise<PlacementRun> {
  const existing = await repo.getRun(tx, id);
  if (existing) return toRun(existing);
  const candidates = await repo.vocabCandidates(tx, MAX_RANK);
  const items: StoredItem[] = buildVocabRound(id, 1, candidates, []);
  if (items.length === 0) items.push(...(await caseRound(tx)));
  const inserted = await repo.insertRun(tx, { id, userId, items, startedAt: deps.clock.now() });
  // The id exists but row level security hides it: it is another learner's run.
  if (!inserted) throw conflict('This id belongs to another placement run.');
  return toRun({
    id,
    userId,
    status: 'active',
    items,
    result: null,
    startedAt: deps.clock.now(),
    completedAt: null,
  });
}

async function caseRound(tx: Tx): Promise<StoredCase[]> {
  const teaching = await repo.teachingLessons(tx);
  const exercises = await repo.clozeExercises(
    tx,
    teaching.map((l) => l.id),
  );
  return buildCaseItems(
    pickCaseExercises(
      teaching.map((l) => l.id),
      exercises,
    ),
  );
}

/** What was returned when round `round` was answered, rebuilt from the stored run. */
function replay(run: repo.RunRow, round: number): PlacementAnswersResult {
  const next = roundOf(run.items, round + 1);
  if (next) return { status: 'active', round: next };
  if (run.result) return { status: run.status, result: run.result };
  return { status: run.status };
}

/** `POST /placement/:id/answers` */
export async function answer(
  tx: Tx,
  deps: PlacementDeps,
  userId: string,
  id: string,
  body: RequestOutput<'placement.answer'>['body'],
): Promise<PlacementAnswersResult> {
  const run = await repo.getRun(tx, id, true);
  if (!run) throw notFound();
  const current = currentRound(run.items);
  const own = run.items.filter((i) => i.round === body.round);
  if (body.round > current || own.length === 0)
    throw conflict(`Round ${body.round} has not been given in this run.`);

  // Validate the answers against the round's items.
  const byId = new Map(own.map((i) => [i.item.itemId, i]));
  const given = new Map<string, Given>();
  const fields: Record<string, string> = {};
  body.answers.forEach((a, n) => {
    const item = byId.get(a.itemId);
    if (!item) fields[`body.answers.${n}.itemId`] = 'Not an item of this round.';
    else if (given.has(a.itemId)) fields[`body.answers.${n}.itemId`] = 'Answered twice.';
    else if (isVocab(item) && a.choice !== undefined && a.choice >= item.item.options.length)
      fields[`body.answers.${n}.choice`] = 'No such option.';
    const g: Given = {};
    if (a.choice !== undefined) g.choice = a.choice;
    if (a.typed !== undefined) g.typed = a.typed;
    given.set(a.itemId, g);
  });
  if (Object.keys(fields).length > 0) throw validationFailed(fields);

  // A round answered before: the same answers return the same next round or result.
  if (own.every((i) => i.answered)) {
    const same = own.every((i) => sameGiven(i.given, given.get(i.item.itemId)));
    if (!same) throw conflict(`Round ${body.round} was already answered differently.`);
    return replay(run, body.round);
  }
  if (run.status !== 'active') throw conflict('This placement run is not active.');

  const now = deps.clock.now();
  const graded = await grade(tx, deps, run.id, own, given, now);
  const items = run.items.map((i) =>
    i.round === body.round ? (graded.get(i.item.itemId) ?? i) : i,
  );

  if (body.round < VOCAB_ROUNDS) {
    const candidates = await repo.vocabCandidates(tx, MAX_RANK);
    const next = buildVocabRound(run.id, body.round + 1, candidates, items.filter(isVocab));
    if (next.length > 0) {
      items.push(...next);
      await repo.updateRun(tx, run.id, { items });
      return { status: 'active', round: { round: body.round + 1, items: next.map((n) => n.item) } };
    }
  }
  if (body.round < CASE_ROUND) {
    const next = await caseRound(tx);
    if (next.length > 0) {
      items.push(...next);
      await repo.updateRun(tx, run.id, { items });
      return { status: 'active', round: { round: CASE_ROUND, items: next.map((n) => n.item) } };
    }
  }

  // The last round: the result, applied in this same transaction.
  const teaching = (await repo.teachingLessons(tx)).map((l) => l.id);
  const course = await repo.courseLessons(tx);
  const result = buildResult(items, teaching, course);
  await repo.updateRun(tx, run.id, { items, status: 'completed', result, completedAt: now });
  await applyResult(tx, deps.ports, { userId, items, result, completedAt: now });
  return { status: 'completed', result };
}

/** Grades the answers of one round. A left out item counts as wrong. */
async function grade(
  tx: Tx,
  deps: PlacementDeps,
  runId: string,
  own: readonly StoredItem[],
  given: Map<string, Given>,
  now: Date,
): Promise<Map<string, StoredItem>> {
  const out = new Map<string, StoredItem>();
  const cases = own.filter(isCase);
  let context: Awaited<ReturnType<typeof caseContext>> | null = null;
  if (cases.length > 0) context = await caseContext(tx, cases);

  for (const item of own) {
    const g = given.get(item.item.itemId) ?? {};
    if (isVocab(item)) {
      out.set(item.item.itemId, {
        ...item,
        answered: true,
        given: g,
        correct: g.choice !== undefined && g.choice === item.correctIndex,
      });
      continue;
    }
    if (!isCase(item) || !context) continue;
    const typed = g.typed ?? '';
    const ex = context.exercises.get(item.exerciseId);
    const lemmaId = ex?.lemmaIds.length === 1 ? ex.lemmaIds[0] : undefined;
    const d = diagnoseForm(typed, {
      answers: item.answers,
      formMap: lemmaId === undefined ? {} : (context.formMaps.get(lemmaId) ?? {}),
      pattern: ex?.pattern ?? undefined,
      gender: ex?.gender,
    });
    const correct = d.diagnosis === 'correct';
    const stored: StoredCase = { ...item, answered: true, given: g, correct };
    if (ex && typed.trim() !== '') {
      const triggerKind = ex.triggerId ? context.triggers.get(ex.triggerId) : undefined;
      const errorType = errorTypeFor(d.diagnosis, {
        triggerKind,
        expectedTag: tagOf({ case: ex.case, number: ex.number }),
      });
      const attempt: AttemptRecord = {
        id: deps.ids.uuid(),
        source: 'placement',
        sourceRef: runId,
        exerciseId: ex.id,
        case: ex.case,
        number: ex.number,
        gender: ex.gender,
        correct,
        diagnosis: d.diagnosis,
        given: typed,
        expected: item.answers[0] ?? '',
        occurredAt: now.toISOString(),
      };
      if (lemmaId !== undefined) attempt.lemmaId = lemmaId;
      if (ex.pattern) attempt.pattern = ex.pattern;
      if (ex.triggerId) attempt.triggerId = ex.triggerId;
      if (errorType) attempt.errorType = errorType;
      if (d.diagnosis === 'other_case') {
        const givenCase = d.readings.find((r) => r.case)?.case;
        if (givenCase) attempt.givenCase = givenCase;
      }
      stored.attempt = attempt;
    }
    out.set(item.item.itemId, stored);
  }
  return out;
}

async function caseContext(tx: Tx, cases: readonly StoredCase[]) {
  const lessonIds = [...new Set(cases.map((c) => c.lessonId))];
  const all = await repo.clozeExercises(tx, lessonIds);
  const wanted = new Set(cases.map((c) => c.exerciseId));
  const exercises = new Map(all.filter((e) => wanted.has(e.id)).map((e) => [e.id, e]));
  const lemmaIds = [
    ...new Set([...exercises.values()].flatMap((e) => (e.lemmaIds.length === 1 ? e.lemmaIds : []))),
  ];
  const forms = await repo.formsOf(tx, lemmaIds);
  const formMaps = new Map(
    lemmaIds.map((l) => [l, buildFormMap(forms.filter((f) => f.lemmaId === l))]),
  );
  const triggers = await repo.triggerKinds(tx, [
    ...new Set([...exercises.values()].flatMap((e) => (e.triggerId ? [e.triggerId] : []))),
  ]);
  return { exercises, formMaps, triggers };
}

/**
 * Applies a result in the caller's transaction. Safe to repeat: words already sorted keep
 * their status (only unknown words up to the rank are marked known), lessons that have a row
 * keep it, the profile is written only when it differs, and attempts carry the ids they got
 * when the round was graded, so AttemptsPort skips them the second time.
 */
export async function applyResult(
  tx: Tx,
  ports: Ports,
  run: { userId: string; items: readonly StoredItem[]; result: PlacementResult; completedAt: Date },
): Promise<void> {
  const { result } = run;
  const known = await repo.unknownLemmasUpTo(tx, result.knownUpToRank);
  if (known.length > 0) await ports.notes.setLemmaStatus(tx, known, 'known', 'placement');
  await repo.insertTestedOut(tx, run.userId, result.lessonsTestedOut, run.completedAt);
  if (result.startLessonId)
    await repo.setPlacementOnProfile(tx, run.userId, result.startLessonId, run.completedAt);
  const attempts = run.items.filter(isCase).flatMap((c) => (c.attempt ? [c.attempt] : []));
  if (attempts.length > 0) await ports.attempts.record(tx, attempts);
}
