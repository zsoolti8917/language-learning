import {
  examples,
  LIMITS,
  type TextAnalysis,
  TextAnalysisSchema,
  type TextDetail,
} from '@app/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildChunks,
  chunkOfSentence,
  isTappable,
  phraseOf,
  pollDelay,
  pollTiming,
  selectedTokens,
  sentenceTokens,
  TEXT_IMPORT_MAX_CHARS,
  wordInfo,
} from './analysis';
import { longText } from './fixtures';
import { mockAnalyze } from './mockAnalyzer';
import { triggerText } from './WordSheet';

const TEXT = examples['texts.get'].ok[0].response.body as TextDetail;
const BODY = TEXT.body;
const ANALYSIS = TEXT.analysis as TextAnalysis;

describe('tokens for TokenText', () => {
  it('maps offsets into the sentence and gives punctuation no status', () => {
    const s = ANALYSIS.sentences[1];
    if (!s) throw new Error('no sentence');
    const tokens = sentenceTokens(s, { '21': 'learning', '71': 'known' });
    const text = BODY.slice(s.s, s.e);
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual([
      'Dnes',
      'idem',
      'do',
      'kina',
      '.',
    ]);
    expect(tokens.map((t) => t.status)).toEqual(['known', 'unknown', 'unknown', 'learning', null]);
    expect(isTappable(s.tokens[4] as never)).toBe(false);
  });
});

describe('chunks', () => {
  it('keeps sentences whole, breaks at paragraphs and caps the tokens per chunk', () => {
    const { body, analysis } = longText(400);
    const chunks = buildChunks(analysis, body, 40);
    // Every sentence sits in exactly one chunk, in order.
    expect(chunks[0]?.first).toBe(0);
    expect(chunks.at(-1)?.last).toBe(analysis.sentences.length - 1);
    chunks.forEach((c, i) => {
      if (i > 0) expect(c.first).toBe((chunks[i - 1]?.last as number) + 1);
      expect(c.tokens).toBeLessThanOrEqual(40);
    });
    // A paragraph starts every 10 sentences.
    expect(chunks.filter((c) => c.paragraph)).toHaveLength(40);
    expect(chunkOfSentence(chunks, 25)).toBe(
      chunks.findIndex((c) => c.first <= 25 && c.last >= 25),
    );
  });
});

describe('what the word sheet shows', () => {
  it('a noun after a preposition: case, number and the trigger in words', () => {
    const info = wordInfo(ANALYSIS, BODY, 1, 3);
    expect(info).toMatchObject({
      surface: 'kina',
      lemma: 'kino',
      lemmaId: 21,
      pos: 'noun',
      gender: 'n',
      gloss: ['cinema'],
      case: 'gen',
      number: 'sg',
      trigger: { kind: 'preposition', id: 'prep-do', word: 'do' },
      blank: { start: 13, end: 17 },
    });
    expect(info && triggerText(info)).toBe('After “do” comes the genitive.');
  });

  it('a guessed reading keeps its method', () => {
    const analysis = mockAnalyze('Mám rád kávu.');
    const info = wordInfo(analysis, 'Mám rád kávu.', 0, 2);
    expect(info?.method).toBe('guess');
    expect(info?.case).toBeNull();
  });

  it('punctuation has nothing to show', () => {
    expect(wordInfo(ANALYSIS, BODY, 0, 3)).toBeNull();
  });
});

describe('phrases', () => {
  it('covers the words from the first to the last tapped one, with its sentence', () => {
    const sel = { sentence: 1, anchor: 3, focus: 2 };
    expect(selectedTokens(sel)).toEqual([2, 3]);
    expect(phraseOf(ANALYSIS, BODY, sel)).toEqual({
      textSk: 'do kina',
      blank: { start: 10, end: 17 },
      sentenceSk: 'Dnes idem do kina.',
      sentenceEn: 'Today I am going to the cinema.',
      words: 2,
      glossDraft: 'to, into cinema',
    });
  });
});

describe('polling', () => {
  afterEach(() => {
    pollTiming.baseMs = 1_000;
  });

  it('slows down by half each time, up to 10 s', () => {
    expect([0, 1, 2, 3, 10].map(pollDelay)).toEqual([1_000, 1_500, 2_250, 3_375, 10_000]);
  });
});

describe('limits and the mock analyzer', () => {
  it('uses the import limit of the contract', () => {
    expect(TEXT_IMPORT_MAX_CHARS).toBe(LIMITS.textImportChars);
  });

  it('produces a valid analysis whose offsets point into the body', () => {
    const { body, analysis } = longText(30);
    expect(TextAnalysisSchema.safeParse(analysis).success).toBe(true);
    const words = analysis.sentences.flatMap((s) => s.tokens.map((t) => body.slice(t.s, t.e)));
    expect(words.slice(0, 4)).toEqual(['Bývam', 'v', 'Bratislave', '.']);
    const kina = analysis.sentences[1]?.tokens[3];
    expect(kina).toMatchObject({ l: 21, tag: 's2', trig: { i: 2, kind: 'preposition' } });
  });
});
