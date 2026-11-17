import { describe, expect, it } from 'vitest';
import type { InjectedLabel } from './datasets/types';
import type { CallRecord } from './gateway';
import { analyzerMetrics, routeCosts, tutorMetrics } from './metrics';
import type { ScoredWord } from './runners/analyzer';
import { type ErrorSummary, proposesExpected, type TutorCaseResult } from './runners/tutor';

const label = (over: Partial<InjectedLabel> = {}): InjectedLabel => ({
  start: 8,
  end: 13,
  given: 'mesto',
  expected: 'mesta',
  caseExpected: 'gen',
  caseGiven: 'nom',
  number: 'sg',
  lemma: 'mesto',
  triggerClass: 'preposition',
  trigger: 'do',
  words: [{ start: 8, end: 13, given: 'mesto', expected: 'mesta' }],
  ...over,
});

const err = (over: Partial<ErrorSummary>): ErrorSummary => ({
  start: 8,
  end: 13,
  given: 'mesto',
  expected: 'mesta',
  errorType: 'case_after_preposition',
  caseExpected: 'gen',
  outcome: 'verified',
  matches: true,
  ...over,
});

const caseResult = (over: Partial<TutorCaseResult>): TutorCaseResult => ({
  id: 'x',
  kind: 'injected',
  text: 'Idem do mesto.',
  reported: [],
  kept: [],
  dropped: [],
  found: false,
  foundBeforeVerify: false,
  exact: false,
  ...over,
});

describe('tutor metrics', () => {
  const found = err({});
  const results: TutorCaseResult[] = [
    // Found, exact.
    caseResult({
      label: label(),
      reported: [found],
      kept: [found],
      found: true,
      foundBeforeVerify: true,
      exact: true,
    }),
    // Found with a wrong form, plus a second (false) verified error on the same sentence.
    caseResult({
      label: label({ caseExpected: 'loc', triggerClass: 'verb' }),
      reported: [found, err({ start: 0, end: 4, matches: false })],
      kept: [err({ expected: 'mestom' }), err({ start: 0, end: 4, matches: false })],
      found: true,
      foundBeforeVerify: true,
    }),
    // Reported but left unverified: lost by verification.
    caseResult({
      label: label(),
      reported: [found],
      kept: [err({ outcome: 'unverified', reason: 'not_a_gen_form:mestá' })],
      foundBeforeVerify: true,
    }),
    // Missed.
    caseResult({ label: label() }),
    // Correct sentences: one false correction that verification drops, one that it shows,
    // one clean, and a spelling slip that does not count.
    caseResult({
      kind: 'correct',
      reported: [err({ matches: false })],
      dropped: [err({ matches: false, outcome: 'dropped', reason: 'given_valid_for_case' })],
    }),
    caseResult({
      kind: 'correct',
      reported: [err({ matches: false, caseExpected: 'acc' })],
      kept: [err({ matches: false, caseExpected: 'acc' })],
    }),
    caseResult({ kind: 'correct' }),
    caseResult({
      kind: 'correct',
      reported: [err({ matches: false, errorType: 'spelling', outcome: 'other' })],
      kept: [err({ matches: false, errorType: 'spelling', outcome: 'other' })],
    }),
  ];
  const m = tutorMetrics(results);

  it('counts recall, precision and exact forms after and before verification', () => {
    expect(m.recall).toEqual({ n: 2, of: 4, value: 0.5 });
    expect(m.recallBeforeVerify).toEqual({ n: 3, of: 4, value: 0.75 });
    // Shown case errors: 3 on injected sentences (2 true) and 1 on a correct one.
    expect(m.precision).toEqual({ n: 2, of: 4, value: 0.5 });
    expect(m.precisionBeforeVerify).toEqual({ n: 3, of: 6, value: 0.5 });
    expect(m.exactOfFound).toEqual({ n: 1, of: 2, value: 0.5 });
    expect(m.exactOfAll).toEqual({ n: 1, of: 4, value: 0.25 });
  });

  it('counts false corrections on correct sentences before and after verification', () => {
    expect(m.falseCorrectionsBeforeVerify).toEqual({ n: 2, of: 4, value: 0.5 });
    expect(m.falseCorrections).toEqual({ n: 1, of: 4, value: 0.25 });
    expect(m.falseByCase).toEqual({ acc: 1 });
    expect(m.verification.falseReports).toBe(3);
    expect(m.verification.falseRemoved).toEqual({ n: 1, of: 3, value: 1 / 3 });
    expect(m.verification.trueLost).toEqual({ n: 1, of: 3, value: 1 / 3 });
    expect(m.verification.reasons).toEqual({ given_valid_for_case: 1, not_a_gen_form: 1 });
  });

  it('splits recall by case and by trigger', () => {
    expect(m.byCase.find((r) => r.key === 'gen')?.recall).toEqual({ n: 1, of: 3, value: 1 / 3 });
    expect(m.byCase.find((r) => r.key === 'loc')?.recall).toEqual({ n: 1, of: 1, value: 1 });
    expect(m.byTrigger.map((r) => r.key)).toEqual(['preposition', 'verb']);
  });

  it('counts the rule checks of replies', () => {
    const r = tutorMetrics([
      caseResult({ reply: { text: 'Ok?', issues: [] } }),
      caseResult({ reply: { text: 'mesta', issues: ['no_question', 'leaked:mesta'] } }),
    ]).replies;
    expect(r.checked).toBe(2);
    expect(r.clean.value).toBe(0.5);
    expect(r.noQuestion.n).toBe(1);
    expect(r.leaked.n).toBe(1);
  });

  it('accepts the expected form only for every changed word it covers', () => {
    const two = label({
      start: 8,
      end: 22,
      given: 'pekné mesto',
      expected: 'pekného mesta',
      words: [
        { start: 8, end: 13, given: 'pekné', expected: 'pekného' },
        { start: 14, end: 19, given: 'mesto', expected: 'mesta' },
      ],
    });
    const e = (start: number, end: number, expected: string) => ({
      start,
      end,
      given: '',
      expected,
      correctedSentence: '',
      errorType: 'case_after_preposition' as const,
      explanationEn: '',
    });
    expect(proposesExpected(e(8, 19, 'pekného mesta'), two)).toBe(true);
    expect(proposesExpected(e(8, 19, 'peknému mestu'), two)).toBe(false);
    expect(proposesExpected(e(14, 19, 'Mesta'), two)).toBe(true);
    expect(proposesExpected(e(0, 4, 'mesta'), two)).toBe(false);
  });
});

describe('analyzer metrics', () => {
  const w = (over: Partial<ScoredWord>): ScoredWord => ({
    caseId: 'a',
    form: 'x',
    upos: 'NOUN',
    goldLemma: 'x',
    goldCase: 'gen',
    case: 'gen',
    method: 'single',
    aligned: true,
    lemmaOk: true,
    caseOk: true,
    ...over,
  });
  it('scores known words, splits by method and lists confusions', () => {
    const m = analyzerMetrics([
      w({}),
      w({ method: 'model', case: 'acc', caseOk: false }),
      w({ method: 'rule', upos: 'ADP', goldCase: undefined, caseOk: undefined }),
      w({ method: 'none', lemmaOk: false, case: undefined, caseOk: false, caseId: 'b' }),
      w({ aligned: false }),
    ]);
    expect(m.sentences).toBe(2);
    expect(m.unaligned).toBe(1);
    expect(m.known).toEqual({ n: 3, of: 4, value: 0.75 });
    expect(m.caseAccuracy).toEqual({ n: 1, of: 2, value: 0.5 });
    expect(m.caseAccuracyAll).toEqual({ n: 1, of: 3, value: 1 / 3 });
    expect(m.byMethod.find((r) => r.method === 'model')?.case.value).toBe(0);
    expect(m.confusions[0]).toEqual({ gold: 'gen', chosen: 'acc', n: 1 });
  });
});

describe('route costs', () => {
  it('sums usage per route and model and measures delay', () => {
    const call = (
      route: CallRecord['route'],
      model: string,
      cost: number,
      ms: number,
      cached = false,
    ): CallRecord => ({
      route,
      model,
      cached,
      estimated: false,
      status: 'ok',
      usage: {
        model,
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: cost,
        latencyMs: ms,
        requestId: null,
      },
    });
    const costs = routeCosts([
      call('tutor.reply', 'claude-opus-5-5', 0.01, 1000),
      call('tutor.reply', 'claude-opus-5-5', 0.03, 3000, true),
      call('tutor.reply', 'claude-sonnet-5-5', 0.005, 500),
    ]);
    expect(costs).toHaveLength(2);
    expect(costs[0]).toMatchObject({
      model: 'claude-opus-5-5',
      calls: 2,
      cached: 1,
      inputTokens: 200,
      costUsd: 0.04,
      sentCostUsd: 0.01,
      costPerCallUsd: 0.02,
      latencyMeanMs: 2000,
      latencyP95Ms: 3000,
    });
  });
});
