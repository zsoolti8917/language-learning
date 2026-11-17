/** The seven Slovak cases, in school order (1 nom to 7 ins). Same values as `Case` in contracts. */
export const CASES = ['nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins'] as const;
export type CaseName = (typeof CASES)[number];

/**
 * Tailwind classes per case, written out in full so Tailwind finds them.
 * `text` and `border` use the strong colour, `soft` the tinted background.
 */
export const CASE_CLASSES: Record<CaseName, { text: string; border: string; soft: string }> = {
  nom: { text: 'text-case-nom', border: 'border-case-nom', soft: 'bg-case-nom-soft' },
  gen: { text: 'text-case-gen', border: 'border-case-gen', soft: 'bg-case-gen-soft' },
  dat: { text: 'text-case-dat', border: 'border-case-dat', soft: 'bg-case-dat-soft' },
  acc: { text: 'text-case-acc', border: 'border-case-acc', soft: 'bg-case-acc-soft' },
  voc: { text: 'text-case-voc', border: 'border-case-voc', soft: 'bg-case-voc-soft' },
  loc: { text: 'text-case-loc', border: 'border-case-loc', soft: 'bg-case-loc-soft' },
  ins: { text: 'text-case-ins', border: 'border-case-ins', soft: 'bg-case-ins-soft' },
};

/** CSS variable of a case colour, for inline styles and SVG: `var(--ui-case-gen)`. */
export function caseColorVar(c: CaseName, soft = false): string {
  return `var(--ui-case-${c}${soft ? '-soft' : ''})`;
}
