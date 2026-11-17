// The numbers of a run. Every rate carries its numerator and denominator, so the report can
// show the dataset size behind each figure.
import { type AiRoute, type ErrorType, isCaseErrorType } from '@app/contracts';
import { TRIGGER_CLASSES } from './datasets/types';
import type { CallRecord } from './gateway';
import type { ScoredWord } from './runners/analyzer';
import type { TutorCaseResult } from './runners/tutor';

export interface Rate {
  n: number;
  of: number;
  /** n / of, or null when of is 0. */
  value: number | null;
}

export const rate = (n: number, of: number): Rate => ({ n, of, value: of > 0 ? n / of : null });

/** The proposed targets (docs/work-packages.md, I3). */
export const TARGETS = {
  /** False corrections on correct sentences after verification: at most. */
  falseCorrections: 0.02,
  /** Injected errors found: at least. */
  recall: 0.85,
  /** Analyzer case accuracy: at least. */
  caseAccuracy: 0.95,
} as const;

export interface SplitRow {
  key: string;
  recall: Rate;
  exact: Rate;
}

export interface TutorMetrics {
  cases: { correct: number; injected: number; failed: number };
  /** Injected errors found by a verified case error (what the learner sees). */
  recall: Rate;
  /** Injected errors reported at all, before verification. */
  recallBeforeVerify: Rate;
  /** Verified case errors that are the injected error. */
  precision: Rate;
  /** Case errors reported before verification that are the injected error. */
  precisionBeforeVerify: Rate;
  /** Found errors whose correction is exactly the treebank's form. */
  exactOfFound: Rate;
  /** Injected errors corrected with exactly the treebank's form. */
  exactOfAll: Rate;
  /** Correct sentences with at least one verified case error. */
  falseCorrections: Rate;
  /** Correct sentences with at least one reported case error, before verification. */
  falseCorrectionsBeforeVerify: Rate;
  verification: {
    /** Reported case errors that are not the injected error (both sets). */
    falseReports: number;
    /** Of those, removed by verification (dropped, or unverified and so never shown). */
    falseRemoved: Rate;
    /** True reports (the injected error) that verification removed or left unverified. */
    trueLost: Rate;
    /** Why errors were dropped or left unverified, by reason. */
    reasons: Record<string, number>;
  };
  byCase: SplitRow[];
  byTrigger: SplitRow[];
  /** False corrections on correct sentences by the case the model claimed. */
  falseByCase: Record<string, number>;
  /** False corrections on correct sentences by error type. */
  falseByType: Record<string, number>;
  replies: {
    checked: number;
    /** Replies with no issue. */
    clean: Rate;
    tooLong: Rate;
    /** Replies that prompt an error but ask no question. */
    noQuestion: Rate;
    /** Replies that name a form that was not verified. */
    leaked: Rate;
    markdown: Rate;
    empty: Rate;
  };
}

const isCase = (t: string) => isCaseErrorType(t as ErrorType);

export function tutorMetrics(results: readonly TutorCaseResult[]): TutorMetrics {
  const injected = results.filter((r) => r.kind === 'injected');
  const correct = results.filter((r) => r.kind === 'correct');
  const shownOf = (r: TutorCaseResult) =>
    r.kept.filter((e) => e.outcome === 'verified' && isCase(e.errorType));
  const reportedOf = (r: TutorCaseResult) => r.reported.filter((e) => isCase(e.errorType));

  let shown = 0;
  let shownTrue = 0;
  let reported = 0;
  let reportedTrue = 0;
  let falseReports = 0;
  let falseRemoved = 0;
  let trueReports = 0;
  let trueLost = 0;
  const reasons: Record<string, number> = {};
  for (const r of results) {
    const s = shownOf(r);
    shown += s.length;
    shownTrue += s.filter((e) => e.matches).length;
    const rep = reportedOf(r);
    reported += rep.length;
    reportedTrue += rep.filter((e) => e.matches).length;
    for (const e of [...r.kept, ...r.dropped]) {
      if (!isCase(e.errorType)) continue;
      const removed = e.outcome !== 'verified';
      if (removed) {
        const reason = (e.reason ?? e.outcome ?? 'unknown').replace(/:.*$/, '');
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      if (e.matches) {
        trueReports++;
        if (removed) trueLost++;
      } else {
        falseReports++;
        if (removed) falseRemoved++;
      }
    }
  }

  const split = (keyOf: (r: TutorCaseResult) => string, keys: readonly string[]): SplitRow[] =>
    keys
      .map((key) => {
        const rows = injected.filter((r) => keyOf(r) === key);
        const found = rows.filter((r) => r.found);
        return {
          key,
          recall: rate(found.length, rows.length),
          exact: rate(found.filter((r) => r.exact).length, found.length),
        };
      })
      .filter((row) => row.recall.of > 0);

  const falseByCase: Record<string, number> = {};
  const falseByType: Record<string, number> = {};
  for (const r of correct)
    for (const e of shownOf(r)) {
      const c = e.caseExpected ?? 'none';
      falseByCase[c] = (falseByCase[c] ?? 0) + 1;
      falseByType[e.errorType] = (falseByType[e.errorType] ?? 0) + 1;
    }

  const replies = results.filter((r) => r.reply);
  const withIssue = (p: (i: string) => boolean) =>
    rate(replies.filter((r) => r.reply?.issues.some(p)).length, replies.length);
  const found = injected.filter((r) => r.found);

  return {
    cases: {
      correct: correct.length,
      injected: injected.length,
      failed: results.filter((r) => r.failure).length,
    },
    recall: rate(found.length, injected.length),
    recallBeforeVerify: rate(injected.filter((r) => r.foundBeforeVerify).length, injected.length),
    precision: rate(shownTrue, shown),
    precisionBeforeVerify: rate(reportedTrue, reported),
    exactOfFound: rate(found.filter((r) => r.exact).length, found.length),
    exactOfAll: rate(found.filter((r) => r.exact).length, injected.length),
    falseCorrections: rate(correct.filter((r) => shownOf(r).length > 0).length, correct.length),
    falseCorrectionsBeforeVerify: rate(
      correct.filter((r) => reportedOf(r).length > 0).length,
      correct.length,
    ),
    verification: {
      falseReports,
      falseRemoved: rate(falseRemoved, falseReports),
      trueLost: rate(trueLost, trueReports),
      reasons,
    },
    byCase: split((r) => r.label?.caseExpected ?? '', ['nom', 'gen', 'dat', 'acc', 'loc', 'ins']),
    byTrigger: split((r) => r.label?.triggerClass ?? '', TRIGGER_CLASSES),
    falseByCase,
    falseByType,
    replies: {
      checked: replies.length,
      clean: rate(replies.filter((r) => r.reply?.issues.length === 0).length, replies.length),
      tooLong: withIssue((i) => i === 'too_long'),
      noQuestion: withIssue((i) => i === 'no_question'),
      leaked: withIssue((i) => i.startsWith('leaked:')),
      markdown: withIssue((i) => i === 'markdown'),
      empty: withIssue((i) => i === 'empty'),
    },
  };
}

export interface MethodRow {
  method: string;
  words: number;
  lemma: Rate;
  case: Rate;
}

export interface AnalyzerMetrics {
  sentences: number;
  words: number;
  /** Gold words the analyzer has no token for (tokenisation differs). */
  unaligned: number;
  /** Gold words the morphology data knows (the analyzer gave them a reading). */
  known: Rate;
  /** Lemma accuracy over known words. */
  lemmaAccuracy: Rate;
  /** Case accuracy over known words with a gold case: the target's measure. */
  caseAccuracy: Rate;
  /** Case accuracy over every word with a gold case, unknown words (no reading) counted wrong. */
  caseAccuracyAll: Rate;
  byMethod: MethodRow[];
  /** Case accuracy by the gold case. */
  byCase: { key: string; case: Rate }[];
  /** The most frequent case confusions, gold → chosen. */
  confusions: { gold: string; chosen: string; n: number }[];
}

export function analyzerMetrics(words: readonly ScoredWord[]): AnalyzerMetrics {
  const aligned = words.filter((w) => w.aligned);
  const known = aligned.filter((w) => w.method !== 'none');
  const casedAll = aligned.filter((w) => w.caseOk !== undefined);
  const cased = known.filter((w) => w.caseOk !== undefined);
  const methods = ['single', 'rule', 'model', 'guess', 'none'];
  const confusions = new Map<string, number>();
  for (const w of cased)
    if (!w.caseOk) {
      const k = `${w.goldCase}→${w.case ?? 'none'}`;
      confusions.set(k, (confusions.get(k) ?? 0) + 1);
    }
  return {
    sentences: new Set(words.map((w) => w.caseId)).size,
    words: words.length,
    unaligned: words.length - aligned.length,
    known: rate(known.length, aligned.length),
    lemmaAccuracy: rate(known.filter((w) => w.lemmaOk).length, known.length),
    caseAccuracy: rate(cased.filter((w) => w.caseOk).length, cased.length),
    caseAccuracyAll: rate(casedAll.filter((w) => w.caseOk).length, casedAll.length),
    byMethod: methods
      .map((method) => {
        const ws = aligned.filter((w) => w.method === method);
        const cs = ws.filter((w) => w.caseOk !== undefined);
        return {
          method,
          words: ws.length,
          lemma: rate(ws.filter((w) => w.lemmaOk).length, ws.length),
          case: rate(cs.filter((w) => w.caseOk).length, cs.length),
        };
      })
      .filter((r) => r.words > 0),
    byCase: ['nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins']
      .map((c) => {
        const cs = cased.filter((w) => w.goldCase === c);
        return { key: c, case: rate(cs.filter((w) => w.caseOk).length, cs.length) };
      })
      .filter((r) => r.case.of > 0),
    confusions: [...confusions]
      .map(([k, n]) => {
        const [gold, chosen] = k.split('→') as [string, string];
        return { gold, chosen, n };
      })
      .sort((a, b) => b.n - a.n || a.gold.localeCompare(b.gold))
      .slice(0, 10),
  };
}

export interface RouteCost {
  route: AiRoute;
  model: string;
  calls: number;
  /** Answered from the cache in this run. */
  cached: number;
  /** Priced from request sizes (dry run). */
  estimated: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Cost of the calls not answered from the cache: what this run spent (or would spend). */
  sentCostUsd: number;
  /** Cost if every call used its whole token limit without the cache (dry run). */
  worstUsd: number;
  costPerCallUsd: number | null;
  latencyMeanMs: number | null;
  latencyP95Ms: number | null;
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, i)] as number;
}

/** Cost and delay per route and model, from the usage of every call (cached ones included). */
export function routeCosts(log: readonly CallRecord[]): RouteCost[] {
  const groups = new Map<string, CallRecord[]>();
  for (const c of log) {
    const k = `${c.route}|${c.model}`;
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }
  return [...groups.values()]
    .map((calls) => {
      const first = calls[0] as CallRecord;
      const sum = (f: (c: CallRecord) => number) => calls.reduce((n, c) => n + f(c), 0);
      const measured = calls.filter((c) => !c.estimated && c.usage.latencyMs > 0);
      const lat = measured.map((c) => c.usage.latencyMs).sort((a, b) => a - b);
      const cost = sum((c) => c.usage.costUsd);
      return {
        route: first.route,
        model: first.model,
        calls: calls.length,
        cached: calls.filter((c) => c.cached).length,
        estimated: calls.filter((c) => c.estimated).length,
        failed: calls.filter((c) => c.status !== 'ok').length,
        inputTokens: sum((c) => c.usage.inputTokens),
        outputTokens: sum((c) => c.usage.outputTokens),
        cacheReadTokens: sum((c) => c.usage.cacheReadTokens),
        cacheWriteTokens: sum((c) => c.usage.cacheWriteTokens),
        costUsd: Math.round(cost * 1e6) / 1e6,
        sentCostUsd:
          Math.round(
            calls.filter((c) => !c.cached).reduce((n, c) => n + c.usage.costUsd, 0) * 1e6,
          ) / 1e6,
        worstUsd: Math.round(sum((c) => c.worstUsd ?? 0) * 1e6) / 1e6,
        costPerCallUsd: calls.length > 0 ? cost / calls.length : null,
        latencyMeanMs:
          lat.length > 0 ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
        latencyP95Ms: percentile(lat, 0.95),
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route) || a.model.localeCompare(b.model));
}
