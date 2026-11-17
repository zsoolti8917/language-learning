// The tutor eval: each sentence is a learner's first message in a conversation. It runs the
// steps of one turn as the API runs them (modules/tutor/pipeline.ts): `tutor.analyze`,
// verification against the morphology data, the decision table, and `tutor.reply` with the
// rule checks on the reply. No database and no transaction are involved.
import type { AiGateway } from '@app/ai';
import {
  type AnalysisError,
  analyzeMessage,
  checkReply,
  decideTurn,
  replyRequest,
  type ScenarioInfo,
  type TriggerInfo,
  type TurnContext,
  type VerifiedError,
  verifyErrors,
} from '@app/api/modules/tutor/pipeline';
import { isAiGatewayError, type MorphologyPort } from '@app/api/ports';
import { isCaseErrorType } from '@app/contracts';
import type { CorrectCase, InjectedCase, InjectedLabel } from '../datasets/types';
import { mapPool } from './pool';

/**
 * The scenario every eval message is sent in: a free conversation, so the scenario does not
 * suggest which cases to expect. Its block is stable, like a real conversation's.
 */
export const EVAL_SCENARIO: ScenarioInfo = {
  id: 'eval-free-talk',
  mode: 'scenario',
  titleEn: 'Free conversation',
  titleSk: 'Voľný rozhovor',
  goalEn: 'Talk about anything: news, history, work or daily life.',
  settingSk: 'Študent a učiteľ sa rozprávajú o čomkoľvek, čo študenta zaujíma.',
  tutorRole: 'A patient Slovak teacher who answers briefly and keeps the learner talking.',
  targetCases: ['nom', 'gen', 'dat', 'acc', 'loc', 'ins'],
  targetTriggers: [],
  level: 'B1',
  openingSk: 'Ahoj! O čom sa dnes budeme rozprávať?',
  successCriteria: [{ id: 'c1', textEn: 'Say something about a topic you like.' }],
  vocabHint: [],
};

/** The user id of every eval call (the gateway needs one for its budget and usage rows). */
export const EVAL_USER_ID = '00000000-0000-4000-8000-0000000e7a15';

/** A reported error as the report keeps it. */
export interface ErrorSummary {
  start: number;
  end: number;
  given: string;
  expected: string;
  errorType: string;
  caseExpected?: string | undefined;
  trigger?: string | undefined;
  /** verified, unverified, other or dropped. */
  outcome?: string | undefined;
  reason?: string | undefined;
  /** It overlaps the label's span. */
  matches: boolean;
}

export interface TutorCaseResult {
  id: string;
  kind: 'correct' | 'injected';
  text: string;
  label?: InjectedLabel | undefined;
  /** Every error the model reported (after the API's normalisation). */
  reported: ErrorSummary[];
  /** Kept by verification, with their outcome. */
  kept: ErrorSummary[];
  /** Removed by verification. */
  dropped: ErrorSummary[];
  /** The label's error was found by a verified case error (what the learner is shown). */
  found: boolean;
  /** The label's error was reported at all, before verification. */
  foundBeforeVerify: boolean;
  /** A found error proposes exactly the expected form. */
  exact: boolean;
  reply?: { text: string; issues: string[] } | undefined;
  /** A gateway error code that stopped the case. */
  failure?: string | undefined;
}

export interface TutorRunOptions {
  gateway: AiGateway;
  morphology: MorphologyPort;
  triggers: readonly TriggerInfo[];
  /** Run `tutor.reply` and its rule checks too. */
  replies: boolean;
  concurrency: number;
}

const lower = (s: string) => s.normalize('NFC').toLowerCase();

function overlaps(e: { start: number; end: number }, l: { start: number; end: number }): boolean {
  return e.start < l.end && l.start < e.end;
}

/** True when the error proposes exactly the treebank's forms for every changed word it covers. */
export function proposesExpected(e: AnalysisError, label: InjectedLabel): boolean {
  const covered = label.words.filter((w) => overlaps(e, w));
  if (covered.length === 0) return false;
  const expected = lower(e.expected);
  return covered.every((w) => {
    const want = lower(w.expected);
    return new RegExp(
      `(^|[^\\p{L}])${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`,
      'u',
    ).test(expected);
  });
}

function summary(e: AnalysisError | VerifiedError, label: InjectedLabel | undefined): ErrorSummary {
  const v = e as VerifiedError;
  return {
    start: e.start,
    end: e.end,
    given: e.given,
    expected: e.expected,
    errorType: e.errorType,
    caseExpected: e.caseExpected,
    trigger: e.trigger,
    outcome: v.outcome,
    reason: v.reason,
    matches: label ? overlaps(e, label) : false,
  };
}

/** Forms the reply must not mention: expected forms that the learner is not shown. */
function hiddenForms(kept: readonly VerifiedError[], dropped: readonly VerifiedError[]): string[] {
  const out = new Set<string>();
  for (const e of [...kept, ...dropped]) {
    if (e.severity !== 'case') continue;
    // A prompted error hides its answer; an unverified or dropped one was never checked.
    out.add(e.target?.answer ?? e.expected);
  }
  return [...out].filter((f) => f.trim() !== '');
}

export async function runTutorCase(
  c: { id: string; text: string; label?: InjectedLabel | undefined },
  kind: 'correct' | 'injected',
  opts: TutorRunOptions,
): Promise<TutorCaseResult> {
  const message = c.text.normalize('NFC').trim();
  const ctx: TurnContext = {
    scenario: EVAL_SCENARIO,
    history: [{ role: 'tutor', content: EVAL_SCENARIO.openingSk }],
    openErrors: [],
    criteria: EVAL_SCENARIO.successCriteria.map((x) => ({ ...x, met: false })),
    message,
  };
  const base: TutorCaseResult = {
    id: c.id,
    kind,
    text: message,
    label: c.label,
    reported: [],
    kept: [],
    dropped: [],
    found: false,
    foundBeforeVerify: false,
    exact: false,
  };
  let analysis: Awaited<ReturnType<typeof analyzeMessage>>['analysis'];
  try {
    ({ analysis } = await analyzeMessage(opts.gateway, EVAL_USER_ID, ctx));
  } catch (e) {
    if (isAiGatewayError(e)) return { ...base, failure: `tutor.analyze:${e.code}` };
    throw e;
  }
  const { kept, dropped } = await verifyErrors(analysis.errors, {
    morphology: opts.morphology,
    triggers: opts.triggers,
  });
  const label = c.label;
  const caseFamily = (e: AnalysisError) => isCaseErrorType(e.errorType);
  const shown = kept.filter((e) => e.outcome === 'verified');
  const result: TutorCaseResult = {
    ...base,
    reported: analysis.errors.map((e) => summary(e, label)),
    kept: kept.map((e) => summary(e, label)),
    dropped: dropped.map((e) => summary(e, label)),
  };
  if (label) {
    const hit = shown.filter((e) => overlaps(e, label));
    result.found = hit.length > 0;
    result.foundBeforeVerify = analysis.errors.some((e) => caseFamily(e) && overlaps(e, label));
    result.exact = hit.some((e) => proposesExpected(e, label));
  }
  if (!opts.replies) return result;

  const decision = decideTurn({
    ctx,
    meaningOk: analysis.meaningOk,
    retries: [],
    goalUpdates: analysis.goalUpdates,
    errors: kept,
    open: [],
    triggers: opts.triggers,
    turnCount: 0,
  });
  try {
    const { text } = await opts.gateway.stream({
      ...replyRequest(ctx, decision.directive),
      userId: EVAL_USER_ID,
      onText: () => {},
    });
    result.reply = {
      text,
      issues: checkReply(text, decision.directive, hiddenForms(kept, dropped)),
    };
  } catch (e) {
    if (isAiGatewayError(e)) result.failure = `tutor.reply:${e.code}`;
    else throw e;
  }
  return result;
}

export async function runTutorEval(
  data: { correct: readonly CorrectCase[]; injected: readonly InjectedCase[] },
  opts: TutorRunOptions,
): Promise<TutorCaseResult[]> {
  const jobs = [
    ...data.injected.map((c) => ({ c, kind: 'injected' as const })),
    ...data.correct.map((c) => ({ c, kind: 'correct' as const })),
  ];
  return mapPool(jobs, opts.concurrency, ({ c, kind }) => runTutorCase(c, kind, opts));
}
