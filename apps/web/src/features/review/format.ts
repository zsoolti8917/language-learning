// Small display helpers of the deck.
import type { NoteContent, Span } from '@app/contracts';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFormat.format(d);
}

/** What the deck shows for a note: the lemma, the phrase or the cue. */
export function noteLabel(content: NoteContent): string {
  if (content.kind === 'word') return content.lemma;
  if (content.kind === 'phrase') return content.textSk;
  return content.cue;
}

export function noteGloss(content: NoteContent): string | null {
  return content.kind === 'case_sentence' ? null : content.glossEn;
}

/** One sentence of a note with the part the card hides. */
export interface NoteSentence {
  sentenceSk: string;
  sentenceEn: string;
  blank: Span;
  /** Form tag of a word variant. */
  tag?: string;
}

export function noteSentences(content: NoteContent): NoteSentence[] {
  if (content.kind === 'word') {
    return content.variants.map((v) => ({
      sentenceSk: v.sentenceSk,
      sentenceEn: v.sentenceEn,
      blank: v.blank,
      tag: v.tag,
    }));
  }
  if (content.kind === 'phrase') return [content.context];
  return [{ sentenceSk: content.sentenceSk, sentenceEn: content.sentenceEn, blank: content.blank }];
}

/** Splits answers typed as one comma separated line. */
export function splitAnswers(line: string): string[] {
  return line
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
