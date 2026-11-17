// The pure steps of a turn on the mini dataset: normalize, verify, decide, cards, prompts.
import { loadMini } from '@app/testkit/mini';
import { describe, expect, it } from 'vitest';
import { createMiniMorphology } from '../../testing/lexicon';
import { type AnalysisError, normalizeAnalysis } from './analysis';
import { caseSentenceContent } from './cards';
import { checkReply, containsForm, decideTurn, MAX_PROMPTS, suggestQuestion } from './decide';
import { analyzeRequest, replyRequest, type ScenarioInfo, type TurnContext } from './prompts';
import { findTrigger, type TriggerInfo, verifyError, verifyErrors } from './verify';

const mini = loadMini();
const triggers: TriggerInfo[] = mini.triggers.map((t) => ({
  id: t.id,
  kind: t.kind,
  lemma: t.lemma,
  case: t.case,
  meaningEn: t.meaningEn,
}));
const deps = { morphology: createMiniMorphology(), triggers };

function err(
  message: string,
  given: string,
  expected: string,
  over: Partial<AnalysisError> = {},
): AnalysisError {
  const start = message.indexOf(given);
  return {
    start,
    end: start + given.length,
    given,
    expected,
    correctedSentence: message.replace(given, expected),
    errorType: 'case_after_preposition',
    explanationEn: 'Explanation.',
    ...over,
  };
}

const KAMARAT = err('Dnes idem do kina s kamarát.', 'kamarát', 'kamarátom', {
  caseExpected: 'ins',
  caseGiven: 'nom',
  lemma: 'kamarát',
  trigger: 's',
});

describe('verify', () => {
  it('verifies a case error and finds its word, number, gender, pattern and trigger', async () => {
    const v = await verifyError(KAMARAT, deps);
    expect(v.outcome).toBe('verified');
    expect(v.triggerId).toBe('prep-s-ins');
    expect(v.target).toMatchObject({
      lemmaId: 2,
      lemma: 'kamarát',
      case: 'ins',
      number: 'sg',
      gender: 'm_anim',
      pattern: 'chlap',
      cue: 'kamarát',
      answer: 'kamarátom',
      answerOffset: 0,
    });
  });

  it('drops an error whose given form is valid for the claimed case', async () => {
    const e = err('Idem do mesta.', 'mesta', 'mesto', { caseExpected: 'gen', lemma: 'mesto' });
    const { kept, dropped } = await verifyErrors([e], deps);
    expect(kept).toEqual([]);
    expect(dropped[0]?.reason).toBe('given_valid_for_case');
  });

  it('tells mesta from mestá: the accent changes the case', async () => {
    const e = err('Bývam v mestá.', 'mestá', 'meste', { caseExpected: 'loc', lemma: 'mesto' });
    expect((await verifyError(e, deps)).outcome).toBe('verified');
    const ok = err('Idem do mesta.', 'mesta', 'mestá', { caseExpected: 'gen' });
    expect((await verifyError(ok, deps)).outcome).toBe('dropped');
  });

  it('keeps an expected form that does not exist only as unverified', async () => {
    const e = { ...KAMARAT, expected: 'kamarátem' };
    const v = await verifyError(e, deps);
    expect(v.outcome).toBe('unverified');
    expect(v.target).toBeUndefined();
  });

  it('marks a form of another case as unverified', async () => {
    const e = { ...KAMARAT, expected: 'kamarátovi' };
    expect((await verifyError(e, deps)).outcome).toBe('unverified');
  });

  it('checks only the changed words of a phrase', async () => {
    const msg = 'Bývam v novom dom.';
    const e = err(msg, 'novom dom', 'novom dome', {
      caseExpected: 'loc',
      lemma: 'dom',
      trigger: 'v',
    });
    const v = await verifyError(e, deps);
    expect(v.outcome).toBe('verified');
    expect(v.triggerId).toBe('prep-v-loc');
    expect(v.target).toMatchObject({ lemma: 'dom', cue: 'dom', answer: 'dome', answerOffset: 6 });
  });

  it('accepts so for s without a case check of the preposition', async () => {
    const e = err('Idem s ja.', 's ja', 'so mnou', {
      caseExpected: 'ins',
      errorType: 'pronoun_form',
      lemma: 'ja',
    });
    const v = await verifyError(e, deps);
    expect(v.outcome).toBe('verified');
    expect(v.target).toMatchObject({ lemma: 'ja', answer: 'mnou', answerOffset: 3 });
  });

  it('leaves other slips unchecked and drops a no change error', async () => {
    const other = err('Ja ísť domov.', 'ísť', 'idem', { errorType: 'verb_form' });
    expect((await verifyError(other, deps)).outcome).toBe('other');
    const same = err('Idem do mesta.', 'mesta', 'Mesta', { caseExpected: 'gen' });
    expect((await verifyError(same, deps)).outcome).toBe('dropped');
    expect((await verifyError({ ...KAMARAT, caseExpected: undefined }, deps)).outcome).toBe(
      'unverified',
    );
    expect((await verifyError({ ...KAMARAT, expected: 's kamarátom' }, deps)).reason).toBe(
      'word_count',
    );
  });

  it('finds triggers by word and case, also vocalised', () => {
    expect(findTrigger(triggers, 'so', 'ins')?.id).toBe('prep-s-ins');
    expect(findTrigger(triggers, 'na', 'loc')?.id).toBe('prep-na-loc');
    expect(findTrigger(triggers, 'do', 'loc')?.id).toBe('prep-do');
    expect(findTrigger(triggers, undefined, 'loc')).toBeUndefined();
  });
});

describe('normalizeAnalysis', () => {
  const ctx = { openErrors: [{ id: 'e1' }], criteria: [{ id: 'c1' }] };
  it('moves spans onto the given text, drops invented and overlapping errors, filters ids', () => {
    const msg = 'Dnes idem do kina s kamarát.';
    const a = normalizeAnalysis(
      msg,
      {
        errors: [
          { ...KAMARAT, start: 0, end: 7 },
          { ...KAMARAT, given: 'kamarátka', start: 3, end: 5 },
          { ...KAMARAT, given: 's kamarát', start: 18, end: 27 },
        ],
        retries: [
          { errorId: 'e1', fixed: true },
          { errorId: 'e1', fixed: false },
          { errorId: 'x', fixed: true },
        ],
        goalUpdates: [
          { criterionId: 'c1', met: true },
          { criterionId: 'c9', met: true },
        ],
        meaningOk: true,
      },
      ctx,
    );
    expect(a.errors).toHaveLength(1);
    expect(a.errors[0]).toMatchObject({ start: 20, end: 27, given: 'kamarát' });
    expect(a.retries).toEqual([{ errorId: 'e1', fixed: true }]);
    expect(a.goalUpdates).toEqual([{ criterionId: 'c1', met: true }]);
  });
});

const scenarioRow = mini.scenarios.find((s) => s.id === 'scn-city-walk');
if (!scenarioRow) throw new Error('mini scenario missing');
const scenario: ScenarioInfo = {
  id: scenarioRow.id,
  mode: scenarioRow.mode,
  titleEn: scenarioRow.titleEn,
  titleSk: scenarioRow.titleSk,
  goalEn: scenarioRow.goalEn,
  settingSk: scenarioRow.settingSk,
  tutorRole: scenarioRow.tutorRole,
  targetCases: scenarioRow.targetCases,
  targetTriggers: scenarioRow.targetTriggers,
  level: scenarioRow.level,
  openingSk: scenarioRow.openingSk,
  successCriteria: scenarioRow.successCriteria,
  vocabHint: scenarioRow.vocabHint,
};
const ctxOf = (message: string, over: Partial<TurnContext> = {}): TurnContext => ({
  scenario,
  history: [{ role: 'tutor', content: scenario.openingSk }],
  openErrors: [],
  criteria: scenario.successCriteria.map((c) => ({ ...c, met: false })),
  message,
  ...over,
});

describe('decide', () => {
  it('prompts at most two verified case errors, in order of position', async () => {
    const msg = 'Idem do mesto s kamarát a bývam v mesto.';
    const errors = [
      err(msg, 'kamarát', 'kamarátom', { caseExpected: 'ins', trigger: 's' }),
      err(msg, 'mesto', 'mesta', { caseExpected: 'gen', trigger: 'do' }),
      { ...err(msg, 'mesto', 'meste', { caseExpected: 'loc', trigger: 'v' }), start: 34, end: 39 },
    ];
    const { kept } = await verifyErrors(errors, deps);
    const d = decideTurn({
      ctx: ctxOf(msg),
      meaningOk: true,
      retries: [],
      goalUpdates: [{ criterionId: 'c1', met: true }],
      errors: kept,
      open: [],
      triggers,
      turnCount: 0,
    });
    expect(d.newErrors.map((n) => [n.error.given, n.status])).toEqual([
      ['mesto', 'prompted'],
      ['kamarát', 'prompted'],
      ['mesto', 'summary_only'],
    ]);
    expect(d.directive.prompts).toHaveLength(MAX_PROMPTS);
    expect(d.directive.prompts[1]).toMatchObject({ caseExpected: 'ins', question: 'S kým?' });
    // A prompted error's form never reaches the reply model.
    expect(JSON.stringify(d.directive)).not.toContain('kamarátom');
    expect(JSON.stringify(d.directive)).not.toContain('mesta');
    expect(d.criteriaMet).toEqual(['c1']);
    expect(d.directive.goal.next?.id).toBe('c2');
  });

  const open = {
    id: 'e1',
    messageId: 'm1',
    given: 'kamarát',
    expected: 'kamarátom',
    caseExpected: 'ins' as const,
    lemmaId: 2,
    triggerId: 'prep-s-ins',
    explanationEn: 'After s use the instrumental.',
  };
  const base = { meaningOk: true, goalUpdates: [], errors: [], triggers, turnCount: 1 };

  it('a fixed retry becomes self_corrected, by the model or by the form in the text', () => {
    const byModel = decideTurn({
      ...base,
      ctx: ctxOf('Áno.'),
      retries: [{ errorId: 'e1', fixed: true }],
      open: [open],
    });
    expect(byModel.resolutions[0]).toMatchObject({ status: 'self_corrected', by: 'model' });
    const byText = decideTurn({
      ...base,
      ctx: ctxOf('Idem s kamarátom.'),
      retries: [],
      open: [open],
    });
    expect(byText.resolutions[0]).toMatchObject({ status: 'self_corrected', by: 'text' });
    expect(byText.directive.confirm).toEqual([{ form: 'kamarátom' }]);
    expect(byText.directive.allowedForms).toEqual(['kamarátom']);
  });

  it('a second miss, a repeat or no retry becomes corrected', async () => {
    const miss = decideTurn({
      ...base,
      ctx: ctxOf('S kamarát.'),
      retries: [{ errorId: 'e1', fixed: false }],
      open: [open],
    });
    expect(miss.resolutions[0]?.status).toBe('corrected');
    expect(miss.directive.corrections).toEqual([
      { given: 'kamarát', expected: 'kamarátom', reasonEn: 'After s use the instrumental.' },
    ]);
    const msg = 'S kamarát.';
    const { kept } = await verifyErrors(
      [err(msg, 'kamarát', 'kamarátom', { caseExpected: 'ins' })],
      deps,
    );
    const repeat = decideTurn({
      ...base,
      ctx: ctxOf(msg),
      retries: [],
      errors: kept,
      open: [open],
    });
    expect(repeat.resolutions[0]).toMatchObject({ status: 'corrected', by: 'repeated' });
    expect(repeat.newErrors).toEqual([]);
    const none = decideTurn({ ...base, ctx: ctxOf('Neviem.'), retries: [], open: [open] });
    expect(none.resolutions[0]).toMatchObject({ status: 'corrected', by: 'not_tried' });
  });

  it('prompts nothing when the message cannot be understood', async () => {
    const { kept } = await verifyErrors([KAMARAT], deps);
    const d = decideTurn({
      ...base,
      ctx: ctxOf('Dnes idem do kina s kamarát.'),
      meaningOk: false,
      retries: [],
      errors: kept,
      open: [],
    });
    expect(d.newErrors[0]?.status).toBe('summary_only');
    expect(d.directive.meaningOk).toBe(false);
  });

  it('suggests questions and checks replies', () => {
    expect(suggestQuestion('gen', undefined, findTrigger(triggers, 'do', 'gen'))).toBe('Do čoho?');
    expect(
      suggestQuestion('dat', { gender: 'm_anim' } as never, findTrigger(triggers, 'k', 'dat')),
    ).toBe('Ku komu?');
    expect(containsForm('Idem s kamarátom.', 'kamarátom')).toBe(true);
    expect(containsForm('Idem s kamarátomka.', 'kamarátom')).toBe(false);
    const d = decideTurn({ ...base, ctx: ctxOf('x'), retries: [], open: [] });
    const prompting = {
      ...d.directive,
      prompts: [{ given: 'kamarát', caseExpected: 'ins' as const }],
    };
    expect(checkReply('S kamarátom ideš?', prompting, ['kamarátom'])).toEqual(['leaked:kamarátom']);
    expect(checkReply('Dobre.', prompting, [])).toEqual(['no_question']);
    expect(checkReply('S kým ideš?', prompting, ['kamarátom'])).toEqual([]);
  });
});

describe('cards', () => {
  it('blanks the corrected word in the corrected sentence', async () => {
    const msg = 'Ahoj! Potom ideme do mesto. Bude to fajn.';
    const e = err(msg, 'mesto', 'mesta', { caseExpected: 'gen', lemma: 'mesto', trigger: 'do' });
    const v = await verifyError(e, deps);
    if (!v.target) throw new Error('not verified');
    const c = caseSentenceContent({
      message: msg,
      error: e,
      target: v.target,
      sentenceEn: 'Then we go to town.',
      triggerId: v.triggerId,
    });
    expect(c).toEqual({
      kind: 'case_sentence',
      sentenceSk: 'Potom ideme do mesta.',
      sentenceEn: 'Then we go to town.',
      blank: { start: 15, end: 20 },
      cue: 'mesto',
      answers: ['mesta'],
      features: { case: 'gen', number: 'sg', gender: 'n' },
      lemmaId: 20,
      triggerId: 'prep-do',
    });
  });
});

describe('prompts', () => {
  it('keeps the system blocks the same for every turn and free of changing values', () => {
    const a = analyzeRequest(ctxOf('Idem do mesta.'));
    const b = analyzeRequest(ctxOf('Bývam v Bratislave.', { history: [] }));
    expect(a.system).toEqual(b.system);
    const d = decideTurn({
      ctx: ctxOf('x'),
      meaningOk: true,
      retries: [],
      goalUpdates: [],
      errors: [],
      open: [],
      triggers,
      turnCount: 0,
    });
    const r1 = replyRequest(ctxOf('x'), d.directive);
    const r2 = replyRequest(ctxOf('y'), d.directive);
    expect(r1.system).toEqual(r2.system);
    for (const req of [a, r1]) {
      const text = req.system.map((s) => s.text).join('\n');
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(req.system.at(-1)?.cache).toBe(true);
      expect(req.system.slice(0, -1).every((s) => !s.cache)).toBe(true);
    }
    expect(a.messages[0]?.content).toContain(
      '<learner_message>\nIdem do mesta.\n</learner_message>',
    );
  });
});
