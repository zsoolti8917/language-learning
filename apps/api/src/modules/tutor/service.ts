// Logic of the tutor module. Owner: B9. It takes ports and transactions and knows nothing
// about HTTP. A turn runs: load (transaction 1), analyze, verify, decide, reply (model calls,
// no transaction), store (transaction 2). The steps live in analysis.ts, verify.ts, decide.ts
// and prompts.ts, so the evals can call them one by one.
import { DEFAULT_MODEL, modelFor } from '@app/ai';
import {
  type ConversationDetail,
  type ConversationSummary,
  LIMITS,
  type Message,
  type ResponseOf,
  type TutorError,
  type TutorStreamEvent,
  type TutorSummary,
} from '@app/contracts';
import type { Tx } from '@app/db';
import { tagOf } from '@app/ling';
import { z } from 'zod';
import type { AppDeps } from '../../platform/deps';
import {
  conflict,
  errorBody,
  notFound,
  rateLimited,
  toApiError,
  validationFailed,
} from '../../platform/errors';
import { sseResponse } from '../../platform/sse';
import type { Usage } from '../../ports';
import { analyzeMessage } from './analysis';
import { caseSentenceContent, type ErrorForCard, tutorAttempt } from './cards';
import { decideTurn, MAX_TURNS, type OpenError, suggestQuestion } from './decide';
import {
  CASE_NAMES,
  promptVersionLabel,
  replyRequest,
  type ScenarioInfo,
  summaryRequest,
  type TurnContext,
  translateRequest,
} from './prompts';
import * as repo from './repo';
import { type ErrorTarget, type TriggerInfo, verifyError, verifyErrors } from './verify';

/** What every service function needs from the request. */
export interface TutorCtx {
  userId: string;
  deps: AppDeps;
  withUser<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export const REPLY_MAX_TOKENS = 500;
export const SUMMARY_MAX_TOKENS = 600;
export const KEEP_ALIVE_MS = 15_000;
const RATE_WINDOW_MS = 60_000;

/** What the learner message stores in `annotations`, so a repeat can be answered from the database. */
interface LearnerAnnotations {
  errors: string[];
  resolved: { id: string; status: 'self_corrected' | 'corrected' }[];
  cardsCreated: string[];
  criteriaMet: string[];
  /** The English sentence of each error's card, for when it is corrected later. */
  sentenceEn: Record<string, string>;
  dropped: number;
}

/** Tutor messages may cache their translation. */
interface TutorAnnotations {
  en?: string;
}

const iso = (d: Date) => d.toISOString();

// --- Views ---------------------------------------------------------------------------

/**
 * An error as the client sees it. A prompted error carries no expected form and no
 * explanation, and an unverified case error never shows its unchecked form.
 */
export function toTutorError(r: repo.ErrorRow): TutorError {
  const hideForm = r.status === 'prompted' || (r.severity === 'case' && !r.verified);
  return {
    id: r.id,
    messageId: r.messageId,
    start: r.start,
    end: r.end,
    given: r.given,
    ...(hideForm ? {} : { expected: r.expected }),
    ...(hideForm || !r.correctedSentence ? {} : { correctedSentence: r.correctedSentence }),
    errorType: r.errorType,
    ...(r.caseExpected ? { caseExpected: r.caseExpected } : {}),
    ...(r.caseGiven ? { caseGiven: r.caseGiven } : {}),
    ...(r.lemmaId !== null ? { lemmaId: r.lemmaId } : {}),
    ...(r.triggerId ? { triggerId: r.triggerId } : {}),
    ...(hideForm || !r.explanationEn ? {} : { explanationEn: r.explanationEn }),
    severity: r.severity,
    verified: r.verified,
    status: r.status,
    noteId: r.noteId,
  };
}

function toMessageView(m: repo.MessageRow): Message {
  return { id: m.id, seq: m.seq, role: m.role, content: m.content, createdAt: iso(m.createdAt) };
}

function conversationView(c: repo.ConversationRow): ConversationDetail['conversation'] {
  return {
    id: c.id,
    scenarioId: c.scenarioId,
    mode: c.mode,
    status: c.status,
    goalState: { criteriaMet: c.criteriaMet },
    turnCount: c.turnCount,
    startedAt: iso(c.startedAt),
    endedAt: c.endedAt ? iso(c.endedAt) : null,
    updatedAt: iso(c.updatedAt),
  };
}

function scenarioBrief(s: ScenarioInfo): ConversationDetail['scenario'] {
  return {
    id: s.id,
    mode: s.mode,
    titleEn: s.titleEn,
    titleSk: s.titleSk,
    goalEn: s.goalEn,
    settingSk: s.settingSk,
    level: s.level,
    successCriteria: s.successCriteria,
    vocabHint: s.vocabHint,
  };
}

async function loadScenario(tx: Tx, id: string): Promise<ScenarioInfo> {
  const s = await repo.getScenario(tx, id);
  // The pipeline proves scenario ids never disappear; a missing one is a content error.
  if (!s) throw new Error(`scenario ${id} is missing`);
  return s;
}

async function detail(tx: Tx, conv: repo.ConversationRow): Promise<ConversationDetail> {
  const [scenario, messages, errors] = await Promise.all([
    loadScenario(tx, conv.scenarioId),
    repo.listMessages(tx, conv.id),
    repo.listErrors(tx, conv.id),
  ]);
  return {
    conversation: conversationView(conv),
    scenario: scenarioBrief(scenario),
    messages: messages.map(toMessageView),
    errors: errors.map(toTutorError),
  };
}

async function ownConversation(tx: Tx, id: string): Promise<repo.ConversationRow> {
  const conv = await repo.getConversation(tx, id);
  if (!conv) throw notFound('No such conversation.');
  return conv;
}

// --- Scenarios and conversations ---------------------------------------------------

export async function listScenarios(tx: Tx): Promise<ResponseOf<'tutor.scenarios'>> {
  const [scenarios, done] = await Promise.all([repo.listScenarios(tx), repo.completedCounts(tx)]);
  return {
    items: scenarios.map((s) => ({
      id: s.id,
      mode: s.mode,
      titleEn: s.titleEn,
      titleSk: s.titleSk,
      goalEn: s.goalEn,
      level: s.level,
      targetCases: s.targetCases,
      timesDone: done.get(s.id) ?? 0,
    })),
  };
}

/** Starts a conversation with the scenario's opening line. A repeated id returns it. */
export async function startConversation(
  tx: Tx,
  t: Pick<TutorCtx, 'userId' | 'deps'>,
  body: { id: string; scenarioId: string },
): Promise<ConversationDetail> {
  const scenario = await repo.getScenario(tx, body.scenarioId);
  if (!scenario) throw notFound('No such scenario.');
  const existing = await repo.getConversation(tx, body.id);
  if (existing) {
    if (existing.scenarioId !== body.scenarioId)
      throw conflict('This conversation id is used for another scenario.');
    return detail(tx, existing);
  }
  const now = t.deps.clock.now();
  const inserted = await repo.insertConversation(tx, {
    id: body.id,
    userId: t.userId,
    scenarioId: scenario.id,
    mode: scenario.mode,
    promptVersion: promptVersionLabel(),
    now,
  });
  if (!inserted) throw conflict('This conversation id is already taken.');
  await repo.insertMessages(tx, [
    {
      id: t.deps.ids.uuid(),
      userId: t.userId,
      conversationId: body.id,
      seq: 0,
      role: 'tutor',
      content: scenario.openingSk,
      createdAt: now,
    },
  ]);
  return detail(tx, await ownConversation(tx, body.id));
}

function encodeCursor(c: { updatedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([iso(c.updatedAt), c.id])).toString('base64url');
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      string,
      string,
    ];
    const updatedAt = new Date(at);
    if (typeof id !== 'string' || Number.isNaN(updatedAt.getTime())) throw new Error('bad');
    return { updatedAt, id };
  } catch {
    throw validationFailed({ 'query.cursor': 'Not a cursor of this list.' });
  }
}

export async function listConversations(
  tx: Tx,
  query: { cursor?: string | undefined; limit: number },
): Promise<ResponseOf<'tutor.listConversations'>> {
  const rows = await repo.listConversations(tx, {
    after: query.cursor ? decodeCursor(query.cursor) : undefined,
    limit: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const items: ConversationSummary[] = page.map((c) => ({
    id: c.id,
    scenarioId: c.scenarioId,
    titleEn: c.titleEn ?? c.scenarioId,
    mode: c.mode,
    status: c.status,
    turnCount: c.turnCount,
    startedAt: iso(c.startedAt),
    endedAt: c.endedAt ? iso(c.endedAt) : null,
    updatedAt: iso(c.updatedAt),
  }));
  return { items, nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null };
}

export async function getConversation(tx: Tx, id: string): Promise<ConversationDetail> {
  return detail(tx, await ownConversation(tx, id));
}

// --- Targets -----------------------------------------------------------------------

/** Re-derives the target word of a stored case error from the morphology data. */
async function targetOf(
  t: TutorCtx,
  row: repo.ErrorRow,
  triggers: readonly TriggerInfo[],
): Promise<ErrorTarget | undefined> {
  if (row.severity !== 'case' || !row.verified || !row.caseExpected) return undefined;
  const v = await verifyError(
    {
      start: row.start,
      end: row.end,
      given: row.given,
      expected: row.expected,
      correctedSentence: row.correctedSentence ?? '',
      errorType: row.errorType,
      caseExpected: row.caseExpected,
      ...(row.caseGiven ? { caseGiven: row.caseGiven } : {}),
      explanationEn: row.explanationEn ?? '',
    },
    { morphology: t.deps.ports.morphology, triggers },
  );
  return v.target;
}

function toOpen(row: repo.ErrorRow, target: ErrorTarget | undefined): OpenError {
  return {
    id: row.id,
    messageId: row.messageId,
    given: row.given,
    expected: row.expected,
    caseExpected: row.caseExpected,
    lemmaId: row.lemmaId,
    triggerId: row.triggerId,
    explanationEn: row.explanationEn,
    target,
  };
}

/**
 * Inside transaction 2: makes the case sentence note of a corrected error, links it, and logs
 * the wrong attempt. Returns the note id when a new note was made.
 */
async function correctError(
  tx: Tx,
  t: TutorCtx,
  input: {
    row: repo.ErrorRow;
    target: ErrorTarget | undefined;
    message: repo.MessageRow | undefined;
    siblings: readonly repo.ErrorRow[];
    status: 'corrected' | 'summary_only';
    logAttempt: boolean;
    now: Date;
  },
): Promise<string | undefined> {
  const { row, target, message, now } = input;
  let noteId: string | undefined;
  let created = false;
  if (target && message) {
    const sentenceEn = (message.annotations as LearnerAnnotations | null)?.sentenceEn?.[row.id];
    const fixes: ErrorForCard[] = input.siblings
      .filter((s) => s.id !== row.id && s.severity === 'case' && s.verified)
      .map((s) => ({ start: s.start, end: s.end, given: s.given, expected: s.expected }));
    const content = caseSentenceContent({
      message: message.content,
      error: row,
      target,
      sentenceEn,
      triggerId: row.triggerId,
      fixes,
    });
    if (content) {
      const note = await t.deps.ports.notes.createCaseSentenceNote(tx, {
        id: t.deps.ids.uuid(),
        source: 'tutor',
        content,
        sourceRef: { tutorErrorId: row.id, conversationId: row.conversationId },
      });
      noteId = note.noteId;
      created = note.created;
    }
  }
  if (input.status === 'corrected' || noteId)
    await repo.resolveError(tx, row.id, {
      status: input.status,
      resolvedAt: now,
      ...(noteId ? { noteId } : {}),
    });
  if (input.logAttempt && target)
    await t.deps.ports.attempts.record(tx, [
      tutorAttempt({
        id: t.deps.ids.uuid(),
        errorId: row.id,
        target,
        correct: false,
        retry: true,
        given: row.given,
        caseGiven: row.caseGiven,
        errorType: row.errorType,
        triggerId: row.triggerId,
        occurredAt: iso(now),
      }),
    ]);
  return created ? noteId : undefined;
}

// --- One turn ------------------------------------------------------------------------

interface LoadedTurn {
  conv: repo.ConversationRow;
  scenario: ScenarioInfo;
  messages: repo.MessageRow[];
  errors: repo.ErrorRow[];
  triggers: TriggerInfo[];
  content: string;
  clientId: string;
}

async function remainingUsd(t: TutorCtx): Promise<number> {
  const spend = await t.deps.usage.spendToday(t.userId);
  return Math.max(0, Math.round((t.deps.config.aiDailyBudgetUsd - spend.spentUsd) * 1e4) / 1e4);
}

function errorEvent(e: unknown): TutorStreamEvent {
  return { event: 'error', data: errorBody(toApiError(e)).error };
}

function isUniqueViolation(e: unknown): boolean {
  for (let x: unknown = e; x && typeof x === 'object'; x = (x as { cause?: unknown }).cause)
    if ((x as { code?: unknown }).code === '23505') return true;
  return false;
}

/** The events of a stored turn, for a repeated `clientId`: no model call. */
async function storedEvents(
  tx: Tx,
  conversationId: string,
  learner: repo.MessageRow,
): Promise<{ events: TutorStreamEvent[] } | null> {
  const messages = await repo.listMessages(tx, conversationId);
  const reply = messages.find((m) => m.seq === learner.seq + 1 && m.role === 'tutor');
  if (!reply) return null;
  const a = (learner.annotations ?? {}) as Partial<LearnerAnnotations>;
  const rows = await repo.errorsByIds(tx, [
    ...(a.errors ?? []),
    ...(a.resolved ?? []).map((r) => r.id),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const errors = (a.errors ?? []).flatMap((id) => {
    const r = byId.get(id);
    return r ? [streamError(r)] : [];
  });
  const resolved = (a.resolved ?? []).flatMap((x) => {
    const r = byId.get(x.id);
    return r ? [resolvedView(r, x.status)] : [];
  });
  return {
    events: [
      { event: 'analysis', data: { messageId: learner.id, errors, resolved } },
      { event: 'delta', data: { text: reply.content } },
      {
        event: 'done',
        data: {
          tutorMessage: { id: reply.id, seq: reply.seq, content: reply.content },
          cardsCreated: a.cardsCreated ?? [],
          goal: { criteriaMet: a.criteriaMet ?? [] },
          budget: { remainingUsd: 0 },
        },
      },
    ],
  };
}

function streamError(r: repo.ErrorRow) {
  const view = toTutorError(r);
  return {
    id: r.id,
    start: r.start,
    end: r.end,
    given: r.given,
    errorType: r.errorType,
    status: r.status,
    ...(view.expected !== undefined ? { expected: view.expected } : {}),
    ...(view.explanationEn !== undefined ? { explanationEn: view.explanationEn } : {}),
  };
}

function resolvedView(r: repo.ErrorRow, status: 'self_corrected' | 'corrected') {
  return {
    id: r.id,
    status,
    expected: r.expected,
    ...(r.explanationEn ? { explanationEn: r.explanationEn } : {}),
  };
}

/** `POST /tutor/conversations/:id/messages`: checks, then the event stream of one turn. */
export async function sendMessage(
  t: TutorCtx,
  conversationId: string,
  body: { clientId: string; content: string },
  signal?: AbortSignal,
): Promise<Response> {
  const content = body.content.normalize('NFC').trim();
  const now = t.deps.clock.now();
  const loaded = await t.withUser(async (tx) => {
    const conv = await ownConversation(tx, conversationId);
    const existing = await repo.findByClientId(tx, conversationId, body.clientId);
    if (existing) {
      if (existing.content !== content)
        throw conflict('This message id was already used for another text.');
      const stored = await storedEvents(tx, conversationId, existing);
      if (stored) return { kind: 'replay', events: stored.events } as const;
    }
    if (conv.status !== 'active') throw conflict('This conversation has ended.');
    if (conv.turnCount >= MAX_TURNS)
      throw conflict(`A conversation has at most ${MAX_TURNS} turns. End it to see the summary.`);
    const recent = await repo.countLearnerMessagesSince(
      tx,
      new Date(now.getTime() - RATE_WINDOW_MS),
    );
    if (recent >= LIMITS.tutorMessagesPerMinute)
      throw rateLimited('Too many messages in a minute. Wait a moment.', 60);
    const [scenario, messages, errors, triggers] = await Promise.all([
      loadScenario(tx, conv.scenarioId),
      repo.listMessages(tx, conv.id),
      repo.listErrors(tx, conv.id),
      repo.listTriggers(tx),
    ]);
    const turn: LoadedTurn = {
      conv,
      scenario,
      messages,
      errors,
      triggers,
      content,
      clientId: body.clientId,
    };
    return { kind: 'turn', turn } as const;
  });

  if (loaded.kind === 'replay') {
    const events = loaded.events;
    return sseResponse(
      async (send) => {
        const remaining = await remainingUsd(t);
        for (const e of events)
          send(
            e.event === 'done'
              ? { event: 'done', data: { ...e.data, budget: { remainingUsd: remaining } } }
              : e,
          );
      },
      { signal, keepAliveMs: KEEP_ALIVE_MS },
    );
  }
  return sseResponse(
    (send) => {
      // The turn outlives a client that goes away: storage still completes (waitUntil on Vercel).
      const task = runTurn(t, loaded.turn, send);
      t.deps.background.runInBackground(task);
      return task;
    },
    { signal, keepAliveMs: KEEP_ALIVE_MS },
  );
}

/** Steps 2 to 6 of a turn. Never throws: a failure becomes an `error` event, nothing is stored. */
export async function runTurn(
  t: TutorCtx,
  turn: LoadedTurn,
  send: (e: TutorStreamEvent) => void,
): Promise<void> {
  const { deps } = t;
  const { conv, scenario, messages, errors, triggers, content } = turn;
  try {
    // Every prompted error is from the last turn: each turn resolves the ones before it.
    const openRows = errors.filter((e) => e.status === 'prompted');
    const criteria = scenario.successCriteria.map((c) => ({
      ...c,
      met: conv.criteriaMet.includes(c.id),
    }));
    const ctx: TurnContext = {
      scenario,
      history: messages.map((m) => ({ role: m.role, content: m.content })),
      openErrors: openRows.map((r) => ({
        id: r.id,
        given: r.given,
        caseExpected: r.caseExpected ?? undefined,
        trigger: triggers.find((x) => x.id === r.triggerId)?.lemma,
      })),
      criteria,
      message: content,
    };

    // 2. Analyze, 3. verify (no transaction is open).
    const { analysis, usage: analyzeUsage } = await analyzeMessage(deps.ai, t.userId, ctx);
    const { kept, dropped } = await verifyErrors(analysis.errors, {
      morphology: deps.ports.morphology,
      triggers,
    });
    const open: OpenError[] = [];
    for (const r of openRows) open.push(toOpen(r, await targetOf(t, r, triggers)));

    // 4. Decide.
    const decision = decideTurn({
      ctx,
      meaningOk: analysis.meaningOk,
      retries: analysis.retries,
      goalUpdates: analysis.goalUpdates,
      errors: kept,
      open,
      triggers,
      turnCount: conv.turnCount,
    });

    const learnerId = deps.ids.uuid();
    const tutorId = deps.ids.uuid();
    const lastSeq = messages.at(-1)?.seq ?? -1;
    const learnedAt = deps.clock.now();
    const newRows = decision.newErrors.map((n) => ({
      decision: n,
      row: {
        id: deps.ids.uuid(),
        userId: t.userId,
        conversationId: conv.id,
        messageId: learnerId,
        start: n.error.start,
        end: n.error.end,
        given: n.error.given,
        expected: n.error.expected,
        correctedSentence: n.error.correctedSentence || null,
        errorType: n.error.errorType,
        caseExpected: n.error.caseExpected ?? null,
        caseGiven: n.error.caseGiven ?? null,
        lemmaId: n.error.lemmaId ?? null,
        triggerId: n.error.triggerId ?? null,
        explanationEn: n.error.explanationEn || null,
        severity: n.error.severity,
        verified: n.error.outcome === 'verified',
        status: n.status,
        createdAt: learnedAt,
      } satisfies Omit<repo.ErrorRow, 'noteId' | 'resolvedAt'> & { userId: string },
    }));
    const shown = newRows.filter((n) => n.row.status !== 'summary_only');
    const resolvedRows = new Map(openRows.map((r) => [r.id, r]));
    send({
      event: 'analysis',
      data: {
        messageId: learnerId,
        errors: shown.map((n) => streamError({ ...n.row, noteId: null, resolvedAt: null })),
        resolved: decision.resolutions.flatMap((r) => {
          const row = resolvedRows.get(r.error.id);
          return row ? [resolvedView(row, r.status)] : [];
        }),
      },
    });

    // 5. Reply, streamed.
    const reply = await deps.ai.stream({
      ...replyRequest(ctx, decision.directive),
      userId: t.userId,
      maxTokens: REPLY_MAX_TOKENS,
      onText: (text) => send({ event: 'delta', data: { text } }),
    });
    const replyText = reply.text.trim();

    // 6. Store (transaction 2).
    const stored = await t.withUser(async (tx) => {
      const now = deps.clock.now();
      const cardsCreated: string[] = [];
      const annotations: LearnerAnnotations = {
        errors: shown.map((n) => n.row.id),
        resolved: decision.resolutions.map((r) => ({ id: r.error.id, status: r.status })),
        cardsCreated,
        criteriaMet: decision.criteriaMet,
        sentenceEn: Object.fromEntries(
          newRows
            .filter((n) => n.decision.error.correctedSentenceEn)
            .map((n) => [n.row.id, n.decision.error.correctedSentenceEn ?? '']),
        ),
        dropped: dropped.length,
      };
      await repo.insertMessages(tx, [
        {
          id: learnerId,
          userId: t.userId,
          conversationId: conv.id,
          seq: lastSeq + 1,
          role: 'learner',
          content,
          annotations,
          clientId: turn.clientId,
          createdAt: learnedAt,
        },
        {
          id: tutorId,
          userId: t.userId,
          conversationId: conv.id,
          seq: lastSeq + 2,
          role: 'tutor',
          content: replyText,
          usage: { analyze: usageCounts(analyzeUsage), reply: usageCounts(reply.usage) },
          createdAt: now,
        },
      ]);
      await repo.insertErrors(
        tx,
        newRows.map((n) => n.row),
      );

      // New verified case errors are wrong first tries.
      const attempts = newRows.flatMap((n) =>
        n.decision.error.outcome === 'verified' && n.decision.error.target
          ? [
              tutorAttempt({
                id: deps.ids.uuid(),
                errorId: n.row.id,
                target: n.decision.error.target,
                correct: false,
                retry: false,
                given: n.row.given,
                caseGiven: n.row.caseGiven,
                errorType: n.row.errorType,
                triggerId: n.row.triggerId,
                occurredAt: iso(learnedAt),
              }),
            ]
          : [],
      );
      for (const r of decision.resolutions) {
        const row = resolvedRows.get(r.error.id);
        if (!row) continue;
        if (r.status === 'self_corrected') {
          await repo.resolveError(tx, row.id, { status: 'self_corrected', resolvedAt: now });
          if (r.error.target)
            attempts.push(
              tutorAttempt({
                id: deps.ids.uuid(),
                errorId: row.id,
                target: r.error.target,
                correct: true,
                retry: true,
                given: r.error.target.answer,
                errorType: row.errorType,
                triggerId: row.triggerId,
                occurredAt: iso(learnedAt),
              }),
            );
        } else {
          const noteId = await correctError(tx, t, {
            row,
            target: r.error.target,
            message: messages.find((m) => m.id === row.messageId),
            siblings: errors.filter((e) => e.messageId === row.messageId),
            status: 'corrected',
            logAttempt: true,
            now,
          });
          if (noteId) cardsCreated.push(noteId);
        }
      }
      if (attempts.length > 0) await deps.ports.attempts.record(tx, attempts);
      if (cardsCreated.length > 0) await repo.setAnnotations(tx, learnerId, annotations);
      await repo.updateConversation(tx, conv.id, {
        criteriaMet: decision.criteriaMet,
        turnCount: conv.turnCount + 1,
        model: modelFor('tutor.reply', deps.config.aiModels) ?? DEFAULT_MODEL,
        promptVersion: promptVersionLabel(),
        now,
      });
      return { seq: lastSeq + 2, cardsCreated, criteriaMet: decision.criteriaMet };
    });

    send({
      event: 'done',
      data: {
        tutorMessage: { id: tutorId, seq: stored.seq, content: replyText },
        cardsCreated: stored.cardsCreated,
        goal: { criteriaMet: stored.criteriaMet },
        budget: { remainingUsd: await remainingUsd(t) },
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      // The same message was stored by a parallel request: answer with what it stored.
      const done = await t
        .withUser(async (tx) => {
          const m = await repo.findByClientId(tx, conv.id, turn.clientId);
          if (!m) return null;
          return storedEvents(tx, conv.id, m);
        })
        .catch(() => null);
      const last = done?.events.at(-1);
      if (last) {
        send(last);
        return;
      }
    }
    send(errorEvent(e));
  }
}

function usageCounts(u: Usage): Record<string, unknown> {
  return {
    model: u.model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    costUsd: u.costUsd,
  };
}

// --- Peek ----------------------------------------------------------------------------

export async function peek(
  t: TutorCtx,
  conversationId: string,
  body: { kind: 'translate' | 'hint' | 'answer'; messageId?: string; errorId?: string },
): Promise<ResponseOf<'tutor.peek'>> {
  if (body.kind === 'translate') {
    const messageId = body.messageId;
    if (!messageId) throw validationFailed({ 'body.messageId': 'Needed to translate.' });
    return translate(t, conversationId, messageId);
  }
  const errorId = body.errorId;
  if (!errorId) throw validationFailed({ 'body.errorId': `Needed for a ${body.kind}.` });
  return body.kind === 'hint'
    ? hint(t, conversationId, errorId)
    : reveal(t, conversationId, errorId);
}

async function translate(
  t: TutorCtx,
  conversationId: string,
  messageId: string,
): Promise<{ text: string }> {
  const loaded = await t.withUser(async (tx) => {
    const conv = await ownConversation(tx, conversationId);
    const m = await repo.getMessage(tx, conversationId, messageId);
    if (!m) throw notFound('No such message.');
    const cached = (m.annotations as TutorAnnotations | null)?.en;
    return { m, cached, scenario: await loadScenario(tx, conv.scenarioId) };
  });
  if (loaded.cached) return { text: loaded.cached };
  const { text } = await t.deps.ai.stream({
    ...translateRequest(loaded.scenario, loaded.m.content),
    userId: t.userId,
    maxTokens: REPLY_MAX_TOKENS,
    onText: () => {},
  });
  const en = text.trim();
  await t.withUser((tx) =>
    repo.setAnnotations(tx, loaded.m.id, { ...(loaded.m.annotations ?? {}), en }),
  );
  return { text: en };
}

async function loadError(
  tx: Tx,
  conversationId: string,
  errorId: string,
): Promise<{ conv: repo.ConversationRow; row: repo.ErrorRow }> {
  const conv = await ownConversation(tx, conversationId);
  const row = await repo.getError(tx, errorId);
  if (!row || row.conversationId !== conv.id) throw notFound('No such error.');
  return { conv, row };
}

/** A hint before the answer: the case, what demands it, a question, and the pattern's ending. */
async function hint(
  t: TutorCtx,
  conversationId: string,
  errorId: string,
): Promise<{ text: string }> {
  const { row, triggers } = await t.withUser(async (tx) => ({
    ...(await loadError(tx, conversationId, errorId)),
    triggers: await repo.listTriggers(tx),
  }));
  const target = await targetOf(t, row, triggers);
  const trigger = triggers.find((x) => x.id === row.triggerId);
  const pattern =
    target?.pattern !== undefined
      ? await t.withUser((tx) => repo.getPattern(tx, target.pattern ?? ''))
      : null;
  const parts = [`Look again at ${row.given}.`];
  const c = row.caseExpected;
  if (c) {
    parts.push(
      trigger
        ? `After ${trigger.lemma} (${trigger.meaningEn}), Slovak uses the ${CASE_NAMES[c]}.`
        : `This place needs the ${CASE_NAMES[c]}.`,
    );
    const question = suggestQuestion(c, target, trigger);
    if (question) parts.push(`Ask yourself: ${question}`);
  }
  if (target && pattern) {
    const ending = pattern.endings[tagOf({ case: target.case, number: target.number })];
    if (ending !== undefined)
      parts.push(
        `Words like ${pattern.labelSk} ${ending === '' ? 'have no ending' : `end in -${ending}`} in the ${CASE_NAMES[target.case]} ${target.number === 'sg' ? 'singular' : 'plural'}.`,
      );
  }
  return { text: parts.join(' ') };
}

/** Shows the answer: the error becomes `corrected`, a wrong attempt is logged, a card is made. */
async function reveal(
  t: TutorCtx,
  conversationId: string,
  errorId: string,
): Promise<{ text: string }> {
  const loaded = await t.withUser(async (tx) => {
    const { row } = await loadError(tx, conversationId, errorId);
    const messages = await repo.listMessages(tx, conversationId);
    const siblings = (await repo.listErrors(tx, conversationId)).filter(
      (e) => e.messageId === row.messageId,
    );
    return { row, messages, siblings, triggers: await repo.listTriggers(tx) };
  });
  const { row } = loaded;
  if (row.severity === 'case' && !row.verified)
    throw conflict('This correction was not checked, so it has no answer to show.');
  const text = row.explanationEn ? `${row.expected}. ${row.explanationEn}` : row.expected;
  if (row.status !== 'prompted') return { text };
  const target = await targetOf(t, row, loaded.triggers);
  await t.withUser(async (tx) => {
    const fresh = await repo.getError(tx, row.id);
    if (fresh?.status !== 'prompted') return;
    await correctError(tx, t, {
      row,
      target,
      message: loaded.messages.find((m) => m.id === row.messageId),
      siblings: loaded.siblings,
      status: 'corrected',
      logAttempt: true,
      now: t.deps.clock.now(),
    });
  });
  return { text };
}

// --- End and dispute -----------------------------------------------------------------

/** Ends a conversation with the summary of `tutor.summary`. A repeat returns the stored one. */
export async function endConversation(
  t: TutorCtx,
  conversationId: string,
): Promise<ResponseOf<'tutor.end'>> {
  const stored = async (tx: Tx, conv: repo.ConversationRow) => {
    const errors = (await repo.listErrors(tx, conv.id)).map(toTutorError);
    const s = (conv.summary ?? {}) as Partial<TutorSummary>;
    return {
      summary: {
        textEn: s.textEn ?? '',
        goalMet: s.goalMet ?? false,
        criteriaMet: conv.criteriaMet,
        errors,
      },
      cardsCreated: await repo.countNotes(tx, conv.id),
    };
  };
  const loaded = await t.withUser(async (tx) => {
    const conv = await ownConversation(tx, conversationId);
    if (conv.status !== 'active') return { kind: 'done', result: await stored(tx, conv) } as const;
    const [scenario, messages, errors, triggers] = await Promise.all([
      loadScenario(tx, conv.scenarioId),
      repo.listMessages(tx, conv.id),
      repo.listErrors(tx, conv.id),
      repo.listTriggers(tx),
    ]);
    return { kind: 'open', conv, scenario, messages, errors, triggers } as const;
  });
  if (loaded.kind === 'done') return loaded.result;
  const { conv, scenario, messages, errors, triggers } = loaded;

  // Still prompted errors become corrected; checked case errors that were only listed get a card.
  const toCard = errors.filter(
    (e) =>
      e.severity === 'case' &&
      e.verified &&
      (e.status === 'prompted' || (e.status === 'summary_only' && !e.noteId)),
  );
  const targets = new Map<string, ErrorTarget | undefined>();
  for (const e of toCard) targets.set(e.id, await targetOf(t, e, triggers));

  const criteria = scenario.successCriteria.map((c) => ({
    ...c,
    met: conv.criteriaMet.includes(c.id),
  }));
  const goalMet = criteria.length > 0 && criteria.every((c) => c.met);
  const learnerMessages = messages.filter((m) => m.role === 'learner').length;
  let textEn = 'You ended the conversation before writing a message.';
  if (learnerMessages > 0) {
    const checked = errors.filter((e) => e.severity === 'case' && e.verified);
    const { data } = await t.deps.ai.structured({
      ...summaryRequest(scenario, {
        criteria,
        learnerMessages,
        errors: checked.map((e) => ({
          given: e.given,
          expected: e.expected,
          caseExpected: e.caseExpected ?? undefined,
          trigger: triggers.find((x) => x.id === e.triggerId)?.lemma,
          fixedAlone: e.status === 'self_corrected',
        })),
        otherErrors: errors.filter((e) => e.severity === 'other').length,
      }),
      userId: t.userId,
      schema: SummarySchema,
      maxTokens: SUMMARY_MAX_TOKENS,
    });
    textEn = data.textEn.trim();
  }

  return t.withUser(async (tx) => {
    const fresh = await ownConversation(tx, conv.id);
    if (fresh.status !== 'active') return stored(tx, fresh);
    const now = t.deps.clock.now();
    for (const e of toCard)
      await correctError(tx, t, {
        row: e,
        target: targets.get(e.id),
        message: messages.find((m) => m.id === e.messageId),
        siblings: errors.filter((x) => x.messageId === e.messageId),
        status: e.status === 'prompted' ? 'corrected' : 'summary_only',
        logAttempt: e.status === 'prompted',
        now,
      });
    const summary: TutorSummary = {
      textEn,
      goalMet,
      criteriaMet: conv.criteriaMet,
      errors: (await repo.listErrors(tx, conv.id)).map(toTutorError),
    };
    await repo.updateConversation(tx, conv.id, {
      status: 'completed',
      endedAt: now,
      summary,
      now,
    });
    return { summary, cardsCreated: await repo.countNotes(tx, conv.id) };
  });
}

/** The answer of the route `tutor.summary`. */
export const SummarySchema = z.object({ textEn: z.string().min(1) });

/** Disputes a correction: suspends its note and files a content report. A repeat changes nothing. */
export async function disputeError(
  tx: Tx,
  t: Pick<TutorCtx, 'userId' | 'deps'>,
  errorId: string,
  body: { comment?: string | undefined },
): Promise<ResponseOf<'tutor.disputeError'>> {
  const row = await repo.getError(tx, errorId);
  if (!row) throw notFound('No such error.');
  if (row.status !== 'disputed') {
    const now = t.deps.clock.now();
    await repo.resolveError(tx, row.id, { status: 'disputed', resolvedAt: now });
    if (row.noteId) await t.deps.ports.notes.suspendNote(tx, row.noteId);
    await repo.insertDisputeReport(tx, {
      id: t.deps.ids.uuid(),
      userId: t.userId,
      errorId: row.id,
      comment: body.comment,
      now,
    });
  }
  return { id: row.id, status: 'disputed' };
}
