// The mock model of the evals: answers built from the datasets' labels, with a controlled
// share of mistakes. It runs the whole harness end to end in tests and CI, and answers for
// the dry run, without a key. Its numbers say nothing about the real model; they prove that
// the harness counts what it should (a perfect oracle scores 100 %, each planted mistake shows
// up in exactly the metric it should).
import {
  createMockGateway,
  type MockGateway,
  type RecordedCall,
  type ScriptedAnswer,
} from '@app/ai';
import type { CaseErrorType } from '@app/contracts';
import { hash32 } from './datasets/rng';
import type { AnalyzerCase, InjectedLabel, TriggerClass } from './datasets/types';
import { sameLemma } from './runners/analyzer';

export interface OracleOptions {
  /** Share of injected errors the oracle misses (0 to 1). */
  missRate?: number;
  /** Share of correct sentences on which it reports a false error (0 to 1). */
  falseRate?: number;
  /** Share of open words it disambiguates wrongly (0 to 1). */
  wrongPickRate?: number;
}

const MESSAGE_RE = /<learner_message>\n([\s\S]*?)\n<\/learner_message>/;

/** A deterministic draw in [0, 1) for a text and a purpose. */
function draw(text: string, purpose: string): number {
  return hash32(`${purpose}:${text}`) / 4294967296;
}

export function errorTypeOf(c: TriggerClass): CaseErrorType {
  if (c === 'preposition') return 'case_after_preposition';
  if (c === 'verb') return 'case_after_verb';
  if (c === 'numeral') return 'case_after_numeral';
  return 'case_other';
}

const WORD_RE = /[\p{L}\p{M}]{4,}/gu;

function analyzeAnswer(
  labels: ReadonlyMap<string, InjectedLabel>,
  message: string,
  opts: OracleOptions,
): ScriptedAnswer {
  const errors: unknown[] = [];
  const label = labels.get(message);
  if (label) {
    if (draw(message, 'miss') >= (opts.missRate ?? 0)) {
      errors.push({
        start: label.start,
        end: label.end,
        given: label.given,
        expected: label.expected,
        correctedSentence:
          message.slice(0, label.start) + label.expected + message.slice(label.end),
        errorType: errorTypeOf(label.triggerClass),
        lemma: label.lemma,
        caseExpected: label.caseExpected,
        caseGiven: label.caseGiven,
        ...(label.trigger ? { trigger: label.trigger } : {}),
        explanationEn: `Use the ${label.caseExpected} here.`,
      });
    }
  } else if (draw(message, 'false') < (opts.falseRate ?? 0)) {
    // A false report on a correct sentence. Half of them claim the case the word already has
    // (verification drops them), half name a form that does not exist (unverified).
    const word = [...message.matchAll(WORD_RE)][0];
    if (word) {
      const dropped = draw(message, 'kind') < 0.5;
      errors.push({
        start: word.index,
        end: word.index + word[0].length,
        given: word[0],
        expected: dropped ? word[0].toUpperCase() : `${word[0]}ou`,
        correctedSentence: message,
        errorType: 'case_other',
        caseExpected: 'nom',
        explanationEn: 'Planted false report.',
      });
    }
  }
  return { data: { errors, retries: [], goalUpdates: [], meaningOk: true } };
}

interface DisambiguationInput {
  contexts: string[];
  words: {
    w: number;
    context: number;
    word: string;
    readings: { i: number; lemma: string; case?: string }[];
  }[];
}

function disambiguateAnswer(
  gold: ReadonlyMap<string, AnalyzerCase>,
  content: string,
  opts: OracleOptions,
): ScriptedAnswer {
  let input: DisambiguationInput;
  try {
    input = JSON.parse(content) as DisambiguationInput;
  } catch {
    return { data: { picks: [] } };
  }
  const picks: { w: number; c: number }[] = [];
  for (const item of input.words) {
    const context = input.contexts[item.context] ?? '';
    const sentence = [...gold.values()].find(
      (g) => context.includes(g.text) || g.text.includes(context),
    );
    const w = sentence?.words.find((x) => x.form === item.word);
    let c = 0;
    if (w) {
      // The gold reading: lemma (by the scoring's conventions) and case, else the case, else
      // the lemma.
      const same = (r: { lemma: string }) => sameLemma(r.lemma, w.lemma, w.upos);
      const order = [
        item.readings.findIndex((r) => same(r) && (w.case === undefined || r.case === w.case)),
        w.case === undefined ? -1 : item.readings.findIndex((r) => r.case === w.case),
        item.readings.findIndex(same),
      ];
      c = order.find((i) => i >= 0) ?? 0;
    }
    if (
      draw(`${context}|${item.word}`, 'pick') < (opts.wrongPickRate ?? 0) &&
      item.readings.length > 1
    )
      c = (c + 1) % item.readings.length;
    picks.push({ w: item.w, c });
  }
  return { data: { picks } };
}

function replyAnswer(call: RecordedCall): ScriptedAnswer {
  const text = call.messages.at(-1)?.content ?? '';
  const question = /suggested question: ([^\n]+)/.exec(text)?.[1];
  if (question) return { text: `Dobre. ${question}` };
  return { text: 'Rozumiem. A čo robíš potom?' };
}

/** A mock gateway that answers the routes the evals use from the datasets' labels. */
export function createOracleGateway(
  data: {
    injected: readonly { text: string; label: InjectedLabel }[];
    analyzer: readonly AnalyzerCase[];
  },
  opts: OracleOptions = {},
): MockGateway {
  const labels = new Map(data.injected.map((c) => [c.text, c.label]));
  const gold = new Map(data.analyzer.map((c) => [c.id, c]));
  const mock = createMockGateway({});
  mock.respond('tutor.analyze', (call) => {
    const message = MESSAGE_RE.exec(call.messages.at(-1)?.content ?? '')?.[1] ?? '';
    return analyzeAnswer(labels, message, opts);
  });
  mock.respond('reader.disambiguate', (call) =>
    disambiguateAnswer(gold, call.messages.at(-1)?.content ?? '', opts),
  );
  mock.respond('tutor.reply', replyAnswer);
  return mock;
}
