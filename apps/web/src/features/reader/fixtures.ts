// Test data of the reader: the contract example text and long texts for the virtual list.
import { EXAMPLE_IDS, examples, type TextAnalysis, type TextDetail } from '@app/contracts';
import { mockAnalyze } from './mockAnalyzer';

export const EXAMPLE_TEXT = examples['texts.get'].ok[0].response.body as TextDetail;
export const EXAMPLE_TEXT_ID: string = EXAMPLE_IDS.text;

/** A long text: `sentences` sentences alternating the two example ones, paragraphs of 10. */
export function longText(sentences: number): { body: string; analysis: TextAnalysis } {
  let body = '';
  for (let i = 0; i < sentences; i++) {
    if (i > 0) body += i % 10 === 0 ? '\n\n' : ' ';
    body += i % 2 === 0 ? 'Bývam v Bratislave.' : 'Dnes idem do kina.';
  }
  return { body, analysis: mockAnalyze(body) };
}

/** A ready text detail around a body and its analysis, every lemma unknown. */
export function textDetail(
  body: string,
  analysis: TextAnalysis,
  overrides: Partial<TextDetail> = {},
): TextDetail {
  return {
    ...EXAMPLE_TEXT,
    body,
    analysis,
    tokenCount: analysis.sentences.reduce((n, s) => n + s.tokens.length, 0),
    uniqueLemmaCount: Object.keys(analysis.lemmas).length,
    lemmaStatus: {},
    phrases: [],
    progress: {},
    ...overrides,
  };
}
