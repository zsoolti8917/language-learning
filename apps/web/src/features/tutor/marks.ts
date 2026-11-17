// Where an error mark sits in the learner's own message.
//
// The server reports `start` and `end` as offsets into the stored message (UTF-16 code units of
// the NFC text, as `String.prototype.indexOf` counts them in the contract examples). Slovak
// letters with accents are one code unit each in NFC, so the offsets line up with what the
// learner sees. If the slice does not match the word the server says was given (the message was
// stored in another normal form, for example), the mark moves to the nearest occurrence of that
// word, so it never covers the wrong characters.

export interface MarkInput {
  id: string;
  start: number;
  end: number;
  given: string;
}

export interface Segment<E extends MarkInput> {
  text: string;
  start: number;
  end: number;
  mark?: E;
}

/** The span of `mark` in `text`, corrected to the given word when the offsets do not match. */
export function locateMark(text: string, mark: MarkInput): { start: number; end: number } | null {
  const given = mark.given.normalize('NFC');
  const start = Math.max(0, Math.min(mark.start, text.length));
  const end = Math.max(start, Math.min(mark.end, text.length));
  if (given === '' || text.slice(start, end).normalize('NFC') === given) {
    return end > start ? { start, end } : null;
  }
  // Nearest occurrence of the given word, by distance from the reported start.
  let best: number | null = null;
  let at = text.indexOf(given);
  while (at !== -1) {
    if (best === null || Math.abs(at - start) < Math.abs(best - start)) best = at;
    at = text.indexOf(given, at + 1);
  }
  if (best !== null) return { start: best, end: best + given.length };
  return end > start ? { start, end } : null;
}

/**
 * Cuts `text` into plain and marked segments. Marks are placed by `locateMark`, sorted by
 * position; a mark that overlaps an earlier one is left out of the text (it still shows in the
 * notes under the message).
 */
export function splitMarks<E extends MarkInput>(text: string, marks: readonly E[]): Segment<E>[] {
  const placed = marks
    .map((mark) => ({ mark, span: locateMark(text, mark) }))
    .filter((p): p is { mark: E; span: { start: number; end: number } } => p.span !== null)
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
  const out: Segment<E>[] = [];
  let pos = 0;
  for (const { mark, span } of placed) {
    if (span.start < pos) continue;
    if (span.start > pos)
      out.push({ text: text.slice(pos, span.start), start: pos, end: span.start });
    out.push({ text: text.slice(span.start, span.end), start: span.start, end: span.end, mark });
    pos = span.end;
  }
  if (pos < text.length || out.length === 0) {
    out.push({ text: text.slice(pos), start: pos, end: text.length });
  }
  return out;
}
