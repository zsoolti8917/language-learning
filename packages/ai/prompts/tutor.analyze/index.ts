// Prompt folder of the route `tutor.analyze`. Owner: B9. Add a version as v<N>.ts and point
// `current` at it; keep old versions for the evals.
import type { RecordedCall, ScriptedAnswer } from '../../src/mock';
import type { PromptFolder } from '../../src/prompt';
import { v1 } from './v1';

/** The learner message inside the user message the API sends (modules/tutor/prompts.ts). */
const MESSAGE_RE = /<learner_message>\n([\s\S]*?)\n<\/learner_message>/;

/**
 * Local mode only: finds the two errors of the mini scenario (s kamarát, do mesto), so the
 * chat can be tried without the real model. Everything else is correct.
 */
function localMock(call: RecordedCall): ScriptedAnswer {
  const text = call.messages.at(-1)?.content ?? '';
  const message = MESSAGE_RE.exec(text)?.[1] ?? '';
  const errors = [];
  const rules = [
    {
      re: /\bs kamarát(?![\p{L}])/u,
      given: 'kamarát',
      expected: 'kamarátom',
      lemma: 'kamarát',
      trigger: 's',
      caseExpected: 'ins',
      caseGiven: 'nom',
      explanationEn: 'After s (with), use the instrumental: kamarátom.',
    },
    {
      re: /\bdo mesto(?![\p{L}])/u,
      given: 'mesto',
      expected: 'mesta',
      lemma: 'mesto',
      trigger: 'do',
      caseExpected: 'gen',
      caseGiven: 'nom',
      explanationEn: 'After do (to), use the genitive: mesta.',
    },
  ] as const;
  for (const r of rules) {
    const m = r.re.exec(message);
    if (!m) continue;
    const start = m.index + m[0].lastIndexOf(r.given);
    errors.push({
      start,
      end: start + r.given.length,
      given: r.given,
      expected: r.expected,
      correctedSentence:
        message.slice(0, start) + r.expected + message.slice(start + r.given.length),
      errorType: 'case_after_preposition',
      lemma: r.lemma,
      caseExpected: r.caseExpected,
      caseGiven: r.caseGiven,
      trigger: r.trigger,
      explanationEn: r.explanationEn,
    });
  }
  return { data: { errors, retries: [], goalUpdates: [], meaningOk: true } };
}

export const prompt: PromptFolder = {
  route: 'tutor.analyze',
  current: 1,
  versions: { 1: v1 },
  mock: localMock,
};
