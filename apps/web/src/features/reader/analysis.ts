// Pure helpers over a stored `TextAnalysis`: tokens for TokenText, chunks for the virtual
// list, what the word sheet shows, phrase spans. Nothing here touches the network.
import type {
  AnalysisSentence,
  AnalysisToken,
  Case,
  Gender,
  GrammaticalNumber,
  LemmaStatus,
  Pos,
  ReadingMethod,
  TextAnalysis,
  TriggerKind,
} from '@app/contracts';
import { readTag } from '@app/ling';
import type { TextToken } from '../../ui';

/** The import limit of `POST /texts` (`LIMITS.textImportChars`; a test keeps them equal). */
export const TEXT_IMPORT_MAX_CHARS = 20_000;

export type StatusMap = Readonly<Record<string, LemmaStatus>>;

/** Only words with a lemma can be tapped; punctuation and numbers stay plain text. */
export function isTappable(token: AnalysisToken): token is AnalysisToken & { l: number } {
  return token.t === 'word' && token.l !== undefined;
}

export function statusOf(statuses: StatusMap, lemmaId: number): LemmaStatus {
  return statuses[String(lemmaId)] ?? 'unknown';
}

/** The text of one sentence, exactly as the analysis offsets point into the body. */
export function sentenceText(body: string, sentence: AnalysisSentence): string {
  return body.slice(sentence.s, sentence.e);
}

/** TokenText tokens of one sentence: offsets relative to the sentence, status per lemma. */
export function sentenceTokens(sentence: AnalysisSentence, statuses: StatusMap): TextToken[] {
  return sentence.tokens.map((t) => ({
    start: t.s - sentence.s,
    end: t.e - sentence.s,
    status: isTappable(t) ? statusOf(statuses, t.l) : null,
  }));
}

// --- Chunks for the virtual list ----------------------------------------------------------

/** A run of whole sentences rendered as one block: a paragraph or a slice of a long one. */
export interface Chunk {
  /** First and last sentence index, inclusive. */
  first: number;
  last: number;
  tokens: number;
  chars: number;
  /** A paragraph starts here (empty line or line break before it in the body). */
  paragraph: boolean;
}

/**
 * Groups sentences into chunks of about `maxTokens` tokens. A chunk never crosses a paragraph
 * break, and a sentence is never split, so text flows normally inside a chunk.
 */
export function buildChunks(analysis: TextAnalysis, body: string, maxTokens = 40): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk | null = null;
  analysis.sentences.forEach((sentence, i) => {
    const prev = analysis.sentences[i - 1];
    const gap = prev ? body.slice(prev.e, sentence.s) : '';
    const paragraph = i === 0 || gap.includes('\n');
    const tokens = sentence.tokens.length;
    const chars = sentence.e - sentence.s;
    if (!current || paragraph || current.tokens + tokens > maxTokens) {
      current = { first: i, last: i, tokens, chars, paragraph };
      chunks.push(current);
    } else {
      current.last = i;
      current.tokens += tokens;
      current.chars += chars + 1;
    }
  });
  return chunks;
}

/** Index of the chunk that holds sentence `n`. */
export function chunkOfSentence(chunks: readonly Chunk[], n: number): number {
  const i = chunks.findIndex((c) => n >= c.first && n <= c.last);
  return Math.max(i, 0);
}

// --- What the word sheet shows -----------------------------------------------------------

export interface WordInfo {
  sentence: number;
  token: number;
  /** The word as it stands in the text. */
  surface: string;
  lemmaId: number;
  lemma: string;
  pos: Pos | null;
  gender: Gender | null;
  gloss: string[];
  tag: string | null;
  case: Case | null;
  number: GrammaticalNumber | null;
  method: ReadingMethod | null;
  trigger: { kind: TriggerKind; id: string | null; word: string | null } | null;
  /** Span of the word inside its sentence. */
  blank: { start: number; end: number };
}

/** Everything the sheet needs about one token, from the stored analysis alone. */
export function wordInfo(
  analysis: TextAnalysis,
  body: string,
  sentenceIndex: number,
  tokenIndex: number,
): WordInfo | null {
  const sentence = analysis.sentences[sentenceIndex];
  const token = sentence?.tokens[tokenIndex];
  if (!sentence || !token || !isTappable(token)) return null;
  const entry = analysis.lemmas[String(token.l)];
  let c: Case | null = null;
  let n: GrammaticalNumber | null = null;
  let g: Gender | null = entry?.gender ?? null;
  if (token.tag) {
    try {
      const reading = readTag(token.tag, entry?.gender);
      c = reading.case ?? null;
      n = reading.number ?? null;
      g = reading.gender ?? g;
    } catch {
      // An unknown tag shows no case; the rest of the sheet still works.
    }
  }
  const trigToken = token.trig?.i !== undefined ? sentence.tokens[token.trig.i] : undefined;
  return {
    sentence: sentenceIndex,
    token: tokenIndex,
    surface: body.slice(token.s, token.e),
    lemmaId: token.l,
    lemma: entry?.lemma ?? body.slice(token.s, token.e),
    pos: entry?.pos ?? null,
    gender: g,
    gloss: entry?.gloss ?? [],
    tag: token.tag ?? null,
    case: c,
    number: n,
    method: token.m ?? null,
    trigger: token.trig
      ? {
          kind: token.trig.kind,
          id: token.trig.id ?? null,
          word: trigToken ? body.slice(trigToken.s, trigToken.e) : null,
        }
      : null,
    blank: { start: token.s - sentence.s, end: token.e - sentence.s },
  };
}

// --- Phrases --------------------------------------------------------------------------------

export interface PhraseSelection {
  sentence: number;
  anchor: number;
  focus: number;
}

/** Indices of the tokens a selection covers, from the first to the last tapped word. */
export function selectedTokens(selection: PhraseSelection): number[] {
  const a = Math.min(selection.anchor, selection.focus);
  const b = Math.max(selection.anchor, selection.focus);
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

export interface Phrase {
  textSk: string;
  /** Span inside the sentence. */
  blank: { start: number; end: number };
  sentenceSk: string;
  sentenceEn: string;
  words: number;
  /** A first meaning from the glosses of the words, for the learner to edit. */
  glossDraft: string;
}

export function phraseOf(
  analysis: TextAnalysis,
  body: string,
  selection: PhraseSelection,
): Phrase | null {
  const sentence = analysis.sentences[selection.sentence];
  if (!sentence) return null;
  const indices = selectedTokens(selection);
  const first = sentence.tokens[indices[0] as number];
  const last = sentence.tokens[indices[indices.length - 1] as number];
  if (!first || !last) return null;
  const sentenceSk = sentenceText(body, sentence);
  const blank = { start: first.s - sentence.s, end: last.e - sentence.s };
  const words = indices.filter((i) => sentence.tokens[i]?.t === 'word');
  const glossDraft = words
    .map((i) => {
      const l = sentence.tokens[i]?.l;
      return l === undefined ? '' : (analysis.lemmas[String(l)]?.gloss[0] ?? '');
    })
    .filter(Boolean)
    .join(' ');
  return {
    textSk: sentenceSk.slice(blank.start, blank.end),
    blank,
    sentenceSk,
    sentenceEn: sentence.en ?? '',
    words: words.length,
    glossDraft,
  };
}

// --- Polling ------------------------------------------------------------------------------

/** Timing of the processing poll; tests shorten it. */
export const pollTiming = { baseMs: 1_000, factor: 1.5, maxMs: 10_000 };

/** Delay before poll number `n` (0, 1, 2, …): it grows by half each time, up to 10 s. */
export function pollDelay(n: number): number {
  return Math.min(pollTiming.maxMs, Math.round(pollTiming.baseMs * pollTiming.factor ** n));
}

/** Coverage as a whole percent, or null when unknown. */
export function percent(share: number | null | undefined): number | null {
  return share === null || share === undefined ? null : Math.round(share * 100);
}
