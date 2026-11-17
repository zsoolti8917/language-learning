// Pure parts of the reader service: lemma status, coverage, titles, phrase spans, the prompt.
import { currentVersion, PROMPTS } from '@app/ai';
import type { TextAnalysis } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { AiGatewayError } from '../../ports';
import {
  computeCoverage,
  failureMessage,
  lemmaStatusOf,
  phraseSpan,
  TranslationSchema,
  titleFrom,
  translationRequest,
} from './service';

describe('lemmaStatusOf', () => {
  it('lets known and ignored rows win, then card stability, then notes', () => {
    expect(lemmaStatusOf(undefined)).toBe('unknown');
    expect(lemmaStatusOf({ status: 'ignored', hasNote: true, stability: 99 })).toBe('ignored');
    expect(lemmaStatusOf({ status: 'known', hasNote: false, stability: null })).toBe('known');
    expect(lemmaStatusOf({ status: 'learning', hasNote: true, stability: 22 })).toBe('known');
    expect(lemmaStatusOf({ status: 'learning', hasNote: true, stability: 21 })).toBe('learning');
    expect(lemmaStatusOf({ hasNote: true, stability: null })).toBe('learning');
    expect(lemmaStatusOf({ status: 'unknown', hasNote: false, stability: null })).toBe('unknown');
  });
});

describe('computeCoverage', () => {
  // Bratislava (31) is a lemma written as a name; Eva has no lemma.
  const body = 'Vidím Bratislavu. Tam má Eva 2 domy.';
  const analysis: TextAnalysis = {
    v: 1,
    sentences: [
      {
        s: 0,
        e: 17,
        tokens: [
          { s: 0, e: 5, t: 'word', l: 65 },
          { s: 6, e: 16, t: 'word', l: 31 },
          { s: 16, e: 17, t: 'punct' },
        ],
      },
      {
        s: 18,
        e: 36,
        tokens: [
          { s: 18, e: 21, t: 'word' },
          { s: 22, e: 24, t: 'word', l: 61 },
          { s: 25, e: 28, t: 'word' },
          { s: 29, e: 30, t: 'num' },
          { s: 31, e: 35, t: 'word', l: 6 },
          { s: 35, e: 36, t: 'punct' },
        ],
      },
    ],
    lemmas: {
      '6': { lemma: 'dom', pos: 'noun', gloss: [] },
      '31': { lemma: 'Bratislava', pos: 'noun', gloss: [] },
      '61': { lemma: 'mať', pos: 'verb', gloss: [] },
      '65': { lemma: 'vidieť', pos: 'verb', gloss: [] },
    },
  };

  it('counts known and ignored lemmas, names and numbers', () => {
    // 7 tokens: Bratislavu (name lemma), Eva (capital, not first), 2 (number) are known.
    expect(computeCoverage(body, analysis, () => 'unknown')).toBeCloseTo(3 / 7);
    const s = (id: number) => (id === 6 ? 'known' : id === 61 ? 'ignored' : 'learning');
    expect(computeCoverage(body, analysis, s)).toBeCloseTo(5 / 7);
  });

  it('does not take a capital at the start of a sentence for a name', () => {
    // "Tam" opens its sentence and has no lemma.
    const all = computeCoverage(body, analysis, () => 'known');
    expect(all).toBeCloseTo(6 / 7);
  });

  it('is null for a text without words', () => {
    expect(computeCoverage('!', { v: 1, sentences: [], lemmas: {} }, () => 'known')).toBeNull();
  });
});

describe('helpers', () => {
  it('makes a title from the first line', () => {
    expect(titleFrom('\n  Môj deň \nDruhý riadok')).toBe('Môj deň');
    const long = titleFrom('slovo '.repeat(30));
    expect([...long].length).toBe(60);
    expect(long.endsWith('…')).toBe(true);
  });

  it('finds a phrase by its capture sentence, then by its text', () => {
    const body = 'V meste je pekne. Bývam v meste.';
    const ctx = { sentenceSk: 'Bývam v meste.', blank: { start: 6, end: 13 } };
    expect(phraseSpan(body, { textSk: 'v meste', context: ctx })).toEqual({ start: 24, end: 31 });
    expect(phraseSpan(body, { textSk: 'v meste' })).toEqual({ start: 0, end: 7 });
    expect(phraseSpan(body, { textSk: 'na ulici' })).toBeNull();
  });

  it('never shows internals in a failure message', () => {
    expect(failureMessage(new Error('secret'))).toBe('The text could not be analysed.');
    expect(failureMessage(new AiGatewayError('budget_exceeded', 'x'))).toContain('budget');
  });

  it('builds the translation request with the sentence before it', () => {
    const body = 'Ahoj. Ako sa máš?';
    const a: TextAnalysis = {
      v: 1,
      sentences: [
        { s: 0, e: 5, tokens: [] },
        { s: 6, e: 17, tokens: [] },
      ],
      lemmas: {},
    };
    expect(translationRequest(body, a, 0)).toBe('<sentence>Ahoj.</sentence>');
    expect(translationRequest(body, a, 1)).toBe(
      '<context>Ahoj.</context>\n<sentence>Ako sa máš?</sentence>',
    );
  });
});

describe('prompt reader.translate', () => {
  it('has a real, cached version 1 and a local mode answer that fits the schema', async () => {
    const folder = PROMPTS['reader.translate'];
    const v = currentVersion(folder);
    expect(v.placeholder).toBeUndefined();
    expect(v.system.at(-1)?.cache).toBe(true);
    expect(v.system[0]?.text).toContain('{"en"');
    const answer = await folder.mock?.({
      kind: 'structured',
      route: 'reader.translate',
      userId: 'u',
      system: [...v.system],
      messages: [{ role: 'user', content: '<sentence>Ahoj.</sentence>' }],
      maxTokens: undefined,
    });
    expect(answer && 'data' in answer && TranslationSchema.parse(answer.data)).toEqual({
      en: '[EN] Ahoj.',
    });
  });
});
