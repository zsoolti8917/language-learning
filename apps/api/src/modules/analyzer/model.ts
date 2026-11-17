// The model step of the analyzer (route `reader.disambiguate`): words the rules left open are
// sent in batches, each word with its candidate readings by index. The answer can only name
// indexes; anything else is ignored and the word falls back to its most frequent reading.
import { currentVersion, PROMPTS } from '@app/ai';
import { z } from 'zod';
import type { Option } from './rules';

/** Words per model call. */
export const MAX_WORDS_PER_CALL = 150;
/** Characters of the user message per call (contexts and readings). */
export const MAX_CHARS_PER_CALL = 24_000;
/** Model calls per text: a text of 20,000 characters never needs more. */
export const MAX_CALLS_PER_TEXT = 8;
/** A sentence longer than this is shown as a window around the word. */
export const MAX_CONTEXT_CHARS = 400;

/** The answer of `reader.disambiguate`: one index per word, nothing else. */
export const DisambiguationSchema = z.object({
  picks: z
    .array(z.object({ w: z.int().nonnegative(), c: z.int().nonnegative() }))
    .max(MAX_WORDS_PER_CALL * 2),
});
export type Disambiguation = z.infer<typeof DisambiguationSchema>;

/** A word the rules left open. */
export interface OpenWord {
  /** The word as written in the text. */
  word: string;
  /** The sentence, or a window around the word for a long sentence. */
  context: string;
  options: Option[];
}

/** What the model sees of a reading. */
function describe(o: Option, i: number): Record<string, string | number> {
  const d: Record<string, string | number> = { i, lemma: o.lemma, pos: o.pos };
  if (o.case) d.case = o.case;
  if (o.number) d.number = o.number;
  if (o.gender) d.gender = o.gender;
  if (o.tag?.startsWith('v:')) d.verbTag = o.tag.slice(2);
  return d;
}

export interface Batch {
  words: OpenWord[];
  /** The user message: JSON data, never instructions. */
  message: string;
}

/** Builds the user message of one batch while it tracks its length. */
class MessageBuilder {
  readonly words: OpenWord[] = [];
  private readonly contexts: string[] = [];
  private readonly contextIndex = new Map<string, number>();
  private readonly items: unknown[] = [];
  /** Length of `{"contexts":[],"words":[]}` plus every part added so far. */
  length = '{"contexts":[],"words":[]}'.length;

  /** The length the message would have with `w` added. */
  lengthWith(w: OpenWord): number {
    const known = this.contextIndex.get(w.context);
    const c = known ?? this.contexts.length;
    let extra = JSON.stringify(this.itemOf(w, c)).length + (this.items.length > 0 ? 1 : 0);
    if (known === undefined)
      extra += JSON.stringify(w.context).length + (this.contexts.length > 0 ? 1 : 0);
    return this.length + extra;
  }

  add(w: OpenWord): void {
    const next = this.lengthWith(w);
    let c = this.contextIndex.get(w.context);
    if (c === undefined) {
      c = this.contexts.length;
      this.contexts.push(w.context);
      this.contextIndex.set(w.context, c);
    }
    this.items.push(this.itemOf(w, c));
    this.words.push(w);
    this.length = next;
  }

  message(): string {
    return JSON.stringify({ contexts: this.contexts, words: this.items });
  }

  private itemOf(w: OpenWord, context: number) {
    return { w: this.items.length, context, word: w.word, readings: w.options.map(describe) };
  }
}

/**
 * Packs the open words, in order, into at most MAX_CALLS_PER_TEXT batches, each within the
 * word and character limits. Words that do not fit are returned in `rest` (they become
 * guesses).
 */
export function packBatches(words: readonly OpenWord[]): { batches: Batch[]; rest: OpenWord[] } {
  const batches: Batch[] = [];
  let i = 0;
  while (i < words.length && batches.length < MAX_CALLS_PER_TEXT) {
    const b = new MessageBuilder();
    while (i < words.length && b.words.length < MAX_WORDS_PER_CALL) {
      const w = words[i] as OpenWord;
      if (b.words.length > 0 && b.lengthWith(w) > MAX_CHARS_PER_CALL) break;
      b.add(w);
      i++;
    }
    batches.push({ words: b.words, message: b.message() });
  }
  return { batches, rest: words.slice(i) };
}

/** The window of `sentence` around [s, e) that the model sees. */
export function contextOf(sentence: string, s: number, e: number): string {
  if (sentence.length <= MAX_CONTEXT_CHARS) return sentence;
  const half = Math.floor((MAX_CONTEXT_CHARS - (e - s)) / 2);
  const from = Math.max(0, s - Math.max(half, 0));
  const to = Math.min(sentence.length, from + MAX_CONTEXT_CHARS);
  return `${from > 0 ? '…' : ''}${sentence.slice(from, to)}${to < sentence.length ? '…' : ''}`;
}

/** The system prompt of the route in use. */
export function systemPrompt() {
  return [...currentVersion(PROMPTS['reader.disambiguate']).system];
}

/** The reading index per word of a batch; words the answer leaves open are missing. */
export function picksOf(batch: Batch, answer: Disambiguation): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of answer.picks) {
    const w = batch.words[p.w];
    if (!w || out.has(p.w) || p.c >= w.options.length) continue;
    out.set(p.w, p.c);
  }
  return out;
}

/** Token limit of a call: a short pick per word. */
export function maxTokensFor(batch: Batch): number {
  return Math.min(8_000, 256 + batch.words.length * 16);
}
