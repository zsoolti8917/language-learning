// Text helpers shared by every package (docs/contracts.md, "Text and time").
// These are the only implementations; the column `ling.form.form_ascii` is built with foldAscii.

const COMBINING_MARKS = /\p{M}+/gu;
const SPACES = /\s+/gu;
const FINAL_PUNCT = /[.?!]$/u;

/** Lower cases a string and strips its accents: `foldAscii("Ľudia") === "ludia"`. */
export function foldAscii(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC');
}

/**
 * Normalises a typed answer: trims, joins repeated spaces, lower cases, and drops one final
 * full stop, question mark or exclamation mark. Accents are kept. The result is in NFC, so a
 * decomposed accent from a phone keyboard compares equal to a precomposed one.
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFC')
    .trim()
    .replace(SPACES, ' ')
    .toLowerCase()
    .replace(FINAL_PUNCT, '')
    .trimEnd();
}
