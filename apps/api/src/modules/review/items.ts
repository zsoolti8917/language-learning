// Pure parts of the review module: what a card asks (prompt, accepted answers, form map,
// explanation) for one sentence of its note. The queue shows it, and the server grades an
// answer against exactly the same target. No input or output here.
import type { Case, FormMap, NoteContent, ReviewItem, TriggerKind } from '@app/contracts';
import { buildFormMap, caseOfTag, formKey, formsWithTag, readTag } from '@app/ling';

/** Reference data the items of one queue or batch need, loaded once. */
export interface LingData {
  lemmas: Map<number, { gender: string | null; pattern: string | null }>;
  forms: Map<number, { form: string; tags: string }[]>;
  triggers: Map<string, { kind: TriggerKind; lemma: string; case: Case }>;
}

export const CASE_NAMES: Readonly<Record<Case, string>> = {
  nom: 'nominative',
  gen: 'genitive',
  dat: 'dative',
  acc: 'accusative',
  voc: 'vocative',
  loc: 'locative',
  ins: 'instrumental',
};

/** The lemma ids and trigger ids a set of notes needs. */
export function lingNeeds(contents: readonly NoteContent[]): {
  lemmaIds: number[];
  triggerIds: string[];
} {
  const lemmaIds = new Set<number>();
  const triggerIds = new Set<string>();
  for (const c of contents) {
    if (c.kind === 'word') lemmaIds.add(c.lemmaId);
    if (c.kind === 'case_sentence') {
      if (c.lemmaId !== undefined) lemmaIds.add(c.lemmaId);
      if (c.triggerId !== undefined) triggerIds.add(c.triggerId);
    }
  }
  return { lemmaIds: [...lemmaIds], triggerIds: [...triggerIds] };
}

/** Number of sentences a note has (a word note one per variant, the others one). */
export function variantCount(content: NoteContent): number {
  return content.kind === 'word' ? Math.max(1, content.variants.length) : 1;
}

/** Which sentence an index names, wrapping around. */
export function variantIndex(content: NoteContent, n: number): number {
  const count = variantCount(content);
  return ((Math.trunc(n) % count) + count) % count;
}

function formMapOf(lemmaId: number | undefined, ling: LingData): FormMap {
  if (lemmaId === undefined) return {};
  return buildFormMap(ling.forms.get(lemmaId) ?? []);
}

function unique(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = formKey(s);
    if (s.trim() === '' || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function safeCase(tag: string): Case | undefined {
  try {
    return caseOfTag(tag);
  } catch {
    return undefined;
  }
}

export type CardTarget = Pick<ReviewItem, 'prompt' | 'answers' | 'formMap' | 'explain'> & {
  variant: number;
};

/** The prompt and accepted answers of sentence `n` of a note. */
export function targetOf(content: NoteContent, n: number, ling: LingData): CardTarget {
  const variant = variantIndex(content, n);
  if (content.kind === 'word') {
    const v = content.variants[variant];
    if (!v) throw new Error('word note without variants');
    const formMap = formMapOf(content.lemmaId, ling);
    const lemma = ling.lemmas.get(content.lemmaId);
    const kase = safeCase(v.tag);
    // Every form with the very same tag is right too (človeku and človekovi).
    const answers = unique([v.answer, ...(kase ? formsWithTag(formMap, v.tag) : [])]);
    let explain: CardTarget['explain'];
    if (kase) {
      const reading = readTag(v.tag);
      explain = {
        case: kase,
        ...(reading.number ? { number: reading.number } : {}),
        ...(lemma?.pattern ? { patternId: lemma.pattern } : {}),
      };
    }
    return {
      variant,
      prompt: {
        sentenceSk: v.sentenceSk,
        blank: v.blank,
        sentenceEn: v.sentenceEn,
        glossEn: content.glossEn,
      },
      answers,
      formMap,
      ...(explain ? { explain } : {}),
    };
  }
  if (content.kind === 'phrase') {
    const { sentenceSk, sentenceEn, blank } = content.context;
    return {
      variant,
      prompt: { sentenceSk, blank, sentenceEn, glossEn: content.glossEn },
      answers: unique([sentenceSk.slice(blank.start, blank.end), content.textSk]),
      formMap: {},
    };
  }
  const trigger = content.triggerId ? ling.triggers.get(content.triggerId) : undefined;
  const lemma = content.lemmaId !== undefined ? ling.lemmas.get(content.lemmaId) : undefined;
  return {
    variant,
    prompt: {
      sentenceSk: content.sentenceSk,
      blank: content.blank,
      sentenceEn: content.sentenceEn,
      cue: content.cue,
    },
    answers: unique(content.answers),
    formMap: formMapOf(content.lemmaId, ling),
    explain: {
      case: content.features.case,
      number: content.features.number,
      ...(trigger ? { triggerLabel: `${trigger.lemma} + ${CASE_NAMES[trigger.case]}` } : {}),
      ...(lemma?.pattern ? { patternId: lemma.pattern } : {}),
    },
  };
}
