// SQL of the tutor module (Drizzle). Owner: B9. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts. Every function takes the
// transaction of the caller (withUser: row level security applies).
import type {
  Case,
  ErrorType,
  Level,
  MessageRole,
  RunStatus,
  ScenarioMode,
  TriggerKind,
  TutorErrorStatus,
} from '@app/contracts';
import {
  contentReport,
  conversation,
  message,
  pattern,
  scenario,
  type Tx,
  trigger,
  tutorError,
} from '@app/db';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { ScenarioInfo } from './prompts';
import type { TriggerInfo } from './verify';

// --- Reference data ----------------------------------------------------------------

type ScenarioRow = typeof scenario.$inferSelect;

function toScenario(r: ScenarioRow): ScenarioInfo & { ord: number } {
  return {
    id: r.id,
    mode: r.mode as ScenarioMode,
    titleEn: r.titleEn,
    titleSk: r.titleSk,
    goalEn: r.goalEn,
    settingSk: r.settingSk,
    tutorRole: r.tutorRole,
    targetCases: r.targetCases as Case[],
    targetTriggers: r.targetTriggers,
    level: r.level as Level,
    openingSk: r.openingSk,
    successCriteria: r.successCriteria,
    vocabHint: r.vocabHint,
    ord: r.ord,
  };
}

export async function listScenarios(tx: Tx): Promise<(ScenarioInfo & { ord: number })[]> {
  const rows = await tx.select().from(scenario).orderBy(asc(scenario.ord), asc(scenario.id));
  return rows.map(toScenario);
}

export async function getScenario(tx: Tx, id: string): Promise<ScenarioInfo | null> {
  const [r] = await tx.select().from(scenario).where(eq(scenario.id, id));
  return r ? toScenario(r) : null;
}

/** Completed conversations of the learner per scenario. */
export async function completedCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx
    .select({ scenarioId: conversation.scenarioId, n: count() })
    .from(conversation)
    .where(eq(conversation.status, 'completed'))
    .groupBy(conversation.scenarioId);
  return new Map(rows.map((r) => [r.scenarioId, Number(r.n)]));
}

export async function listTriggers(tx: Tx): Promise<TriggerInfo[]> {
  const rows = await tx
    .select({
      id: trigger.id,
      kind: trigger.kind,
      lemma: trigger.lemma,
      gCase: trigger.gCase,
      meaningEn: trigger.meaningEn,
    })
    .from(trigger);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as TriggerKind,
    lemma: r.lemma,
    case: r.gCase as Case,
    meaningEn: r.meaningEn,
  }));
}

export async function getTrigger(tx: Tx, id: string): Promise<TriggerInfo | null> {
  const [r] = await tx.select().from(trigger).where(eq(trigger.id, id));
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind as TriggerKind,
    lemma: r.lemma,
    case: r.gCase as Case,
    meaningEn: r.meaningEn,
  };
}

export async function getPattern(
  tx: Tx,
  id: string,
): Promise<{ id: string; labelSk: string; endings: Record<string, string> } | null> {
  const [r] = await tx
    .select({ id: pattern.id, labelSk: pattern.labelSk, endings: pattern.endings })
    .from(pattern)
    .where(eq(pattern.id, id));
  return r ? { id: r.id, labelSk: r.labelSk, endings: r.endings as Record<string, string> } : null;
}

// --- Conversations ---------------------------------------------------------------

export interface ConversationRow {
  id: string;
  userId: string;
  scenarioId: string;
  mode: ScenarioMode;
  status: RunStatus;
  criteriaMet: string[];
  turnCount: number;
  summary: unknown;
  startedAt: Date;
  endedAt: Date | null;
  updatedAt: Date;
}

function toConversation(r: typeof conversation.$inferSelect): ConversationRow {
  return {
    id: r.id,
    userId: r.userId,
    scenarioId: r.scenarioId,
    mode: r.mode as ScenarioMode,
    status: r.status as RunStatus,
    criteriaMet: r.goalState.criteriaMet ?? [],
    turnCount: r.turnCount,
    summary: r.summary ?? null,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    updatedAt: r.updatedAt,
  };
}

export async function getConversation(tx: Tx, id: string): Promise<ConversationRow | null> {
  const [r] = await tx.select().from(conversation).where(eq(conversation.id, id));
  return r ? toConversation(r) : null;
}

/** Inserts the conversation; false when the id is taken (by this or another learner). */
export async function insertConversation(
  tx: Tx,
  row: {
    id: string;
    userId: string;
    scenarioId: string;
    mode: ScenarioMode;
    promptVersion: string;
    now: Date;
  },
): Promise<boolean> {
  const inserted = await tx
    .insert(conversation)
    .values({
      id: row.id,
      userId: row.userId,
      scenarioId: row.scenarioId,
      mode: row.mode,
      status: 'active',
      goalState: { criteriaMet: [] },
      turnCount: 0,
      promptVersion: row.promptVersion,
      startedAt: row.now,
      updatedAt: row.now,
    })
    .onConflictDoNothing({ target: conversation.id })
    .returning({ id: conversation.id });
  return inserted.length > 0;
}

export async function updateConversation(
  tx: Tx,
  id: string,
  patch: {
    status?: RunStatus;
    criteriaMet?: string[];
    turnCount?: number;
    summary?: unknown;
    model?: string;
    promptVersion?: string;
    endedAt?: Date;
    now: Date;
  },
): Promise<void> {
  await tx
    .update(conversation)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.criteriaMet ? { goalState: { criteriaMet: patch.criteriaMet } } : {}),
      ...(patch.turnCount !== undefined ? { turnCount: patch.turnCount } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary as never } : {}),
      ...(patch.model ? { model: patch.model } : {}),
      ...(patch.promptVersion ? { promptVersion: patch.promptVersion } : {}),
      ...(patch.endedAt ? { endedAt: patch.endedAt } : {}),
      updatedAt: patch.now,
    })
    .where(eq(conversation.id, id));
}

/** Newest activity first; the cursor is the last row's `updatedAt` and id. */
export async function listConversations(
  tx: Tx,
  opts: { after?: { updatedAt: Date; id: string } | undefined; limit: number },
): Promise<(ConversationRow & { titleEn: string | null })[]> {
  const where = opts.after
    ? or(
        lt(conversation.updatedAt, opts.after.updatedAt),
        and(eq(conversation.updatedAt, opts.after.updatedAt), lt(conversation.id, opts.after.id)),
      )
    : undefined;
  const rows = await tx
    .select({ c: conversation, titleEn: scenario.titleEn })
    .from(conversation)
    .leftJoin(scenario, eq(scenario.id, conversation.scenarioId))
    .where(where)
    .orderBy(desc(conversation.updatedAt), desc(conversation.id))
    .limit(opts.limit);
  return rows.map((r) => ({ ...toConversation(r.c), titleEn: r.titleEn }));
}

// --- Messages ----------------------------------------------------------------------

export interface MessageRow {
  id: string;
  seq: number;
  role: MessageRole;
  content: string;
  annotations: Record<string, unknown> | null;
  clientId: string | null;
  createdAt: Date;
}

function toMessage(r: typeof message.$inferSelect): MessageRow {
  return {
    id: r.id,
    seq: r.seq,
    role: r.role as MessageRole,
    content: r.content,
    annotations: (r.annotations as Record<string, unknown> | null) ?? null,
    clientId: r.clientId,
    createdAt: r.createdAt,
  };
}

export async function listMessages(tx: Tx, conversationId: string): Promise<MessageRow[]> {
  const rows = await tx
    .select()
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.seq));
  return rows.map(toMessage);
}

export async function getMessage(
  tx: Tx,
  conversationId: string,
  id: string,
): Promise<MessageRow | null> {
  const [r] = await tx
    .select()
    .from(message)
    .where(and(eq(message.conversationId, conversationId), eq(message.id, id)));
  return r ? toMessage(r) : null;
}

export async function findByClientId(
  tx: Tx,
  conversationId: string,
  clientId: string,
): Promise<MessageRow | null> {
  const [r] = await tx
    .select()
    .from(message)
    .where(and(eq(message.conversationId, conversationId), eq(message.clientId, clientId)));
  return r ? toMessage(r) : null;
}

/** Learner messages of this learner since `since`, over all conversations (rate limit). */
export async function countLearnerMessagesSince(tx: Tx, since: Date): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(message)
    .where(and(eq(message.role, 'learner'), gte(message.createdAt, since)));
  return Number(r?.n ?? 0);
}

export async function insertMessages(
  tx: Tx,
  rows: {
    id: string;
    userId: string;
    conversationId: string;
    seq: number;
    role: MessageRole;
    content: string;
    annotations?: unknown;
    usage?: Record<string, unknown>;
    clientId?: string;
    createdAt: Date;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(message).values(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      conversationId: r.conversationId,
      seq: r.seq,
      role: r.role,
      content: r.content,
      annotations: r.annotations ?? null,
      usage: r.usage ?? null,
      clientId: r.clientId ?? null,
      createdAt: r.createdAt,
    })),
  );
}

export async function setAnnotations(tx: Tx, id: string, annotations: unknown): Promise<void> {
  await tx.update(message).set({ annotations }).where(eq(message.id, id));
}

// --- Errors ------------------------------------------------------------------------

export interface ErrorRow {
  id: string;
  conversationId: string;
  messageId: string;
  start: number;
  end: number;
  given: string;
  expected: string;
  correctedSentence: string | null;
  errorType: ErrorType;
  caseExpected: Case | null;
  caseGiven: Case | null;
  lemmaId: number | null;
  triggerId: string | null;
  explanationEn: string | null;
  severity: 'case' | 'other';
  verified: boolean;
  status: TutorErrorStatus;
  noteId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

function toError(r: typeof tutorError.$inferSelect): ErrorRow {
  return {
    id: r.id,
    conversationId: r.conversationId,
    messageId: r.messageId,
    start: r.spanStart,
    end: r.spanEnd,
    given: r.given,
    expected: r.expected,
    correctedSentence: r.correctedSentence,
    errorType: r.errorType as ErrorType,
    caseExpected: (r.caseExpected as Case | null) ?? null,
    caseGiven: (r.caseGiven as Case | null) ?? null,
    lemmaId: r.lemmaId,
    triggerId: r.triggerId,
    explanationEn: r.explanationEn,
    severity: r.severity as 'case' | 'other',
    verified: r.verified,
    status: r.status as TutorErrorStatus,
    noteId: r.noteId,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  };
}

export async function listErrors(tx: Tx, conversationId: string): Promise<ErrorRow[]> {
  const rows = await tx
    .select()
    .from(tutorError)
    .where(eq(tutorError.conversationId, conversationId))
    .orderBy(asc(tutorError.createdAt), asc(tutorError.spanStart), asc(tutorError.id));
  return rows.map(toError);
}

export async function getError(tx: Tx, id: string): Promise<ErrorRow | null> {
  const [r] = await tx.select().from(tutorError).where(eq(tutorError.id, id));
  return r ? toError(r) : null;
}

export async function insertErrors(
  tx: Tx,
  rows: (Omit<ErrorRow, 'noteId' | 'resolvedAt'> & { userId: string })[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(tutorError).values(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      conversationId: r.conversationId,
      messageId: r.messageId,
      spanStart: r.start,
      spanEnd: r.end,
      given: r.given,
      expected: r.expected,
      correctedSentence: r.correctedSentence,
      errorType: r.errorType,
      caseExpected: r.caseExpected,
      caseGiven: r.caseGiven,
      lemmaId: r.lemmaId,
      triggerId: r.triggerId,
      explanationEn: r.explanationEn,
      severity: r.severity,
      verified: r.verified,
      status: r.status,
      createdAt: r.createdAt,
    })),
  );
}

/**
 * Sets the status of an error. `noteId` links the note made from it; the link is set only when
 * the note row exists (the notes stand in keeps notes in memory), so the foreign key holds.
 */
export async function resolveError(
  tx: Tx,
  id: string,
  patch: { status: TutorErrorStatus; resolvedAt: Date; noteId?: string | undefined },
): Promise<void> {
  await tx
    .update(tutorError)
    .set({
      status: patch.status,
      resolvedAt: patch.resolvedAt,
      ...(patch.noteId
        ? { noteId: sql`(select n.id from app.note n where n.id = ${patch.noteId})` }
        : {}),
    })
    .where(eq(tutorError.id, id));
}

/** Notes made from the errors of a conversation. */
export async function countNotes(tx: Tx, conversationId: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(tutorError)
    .where(and(eq(tutorError.conversationId, conversationId), isNotNull(tutorError.noteId)));
  return Number(r?.n ?? 0);
}

export async function errorsByIds(tx: Tx, ids: string[]): Promise<ErrorRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx.select().from(tutorError).where(inArray(tutorError.id, ids));
  return rows.map(toError);
}

// --- Reports -----------------------------------------------------------------------

/** The one row of `content_report` the tutor module writes itself: a dispute. */
export async function insertDisputeReport(
  tx: Tx,
  row: { id: string; userId: string; errorId: string; comment?: string | undefined; now: Date },
): Promise<void> {
  await tx.insert(contentReport).values({
    id: row.id,
    userId: row.userId,
    targetKind: 'tutor_error',
    targetRef: row.errorId,
    comment: row.comment ?? null,
    status: 'open',
    createdAt: row.now,
  });
}
