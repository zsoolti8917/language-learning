// Logic of the lexicon module. Owner: B2. Pure functions: rows to contract shapes, the order
// of lookup candidates, the table of forms, and the request and answer of `reader.gloss`.
// It knows nothing about HTTP and runs no SQL.
import { currentVersion, PROMPTS, type StructuredRequest } from '@app/ai';
import {
  type Aspect,
  CASES,
  type Case,
  type FormCandidate,
  type FormEntry,
  GENDERS,
  type Gender,
  type GrammaticalNumber,
  type Lemma,
  type Paradigm,
  type Pos,
  type Sense,
  type SenseSource,
} from '@app/contracts';
import { readTags, splitTags } from '@app/ling';
import { z } from 'zod';
import type { FormLemmaRow, LemmaRow, SenseRow } from './repo';

// --- Shapes ----------------------------------------------------------------------

export function toLemma(r: LemmaRow): Lemma {
  return {
    id: r.id,
    key: r.key,
    lemma: r.lemma,
    pos: r.pos as Pos,
    gender: (r.gender as Gender | null) ?? null,
    pattern: r.pattern ?? null,
    aspect: (r.aspect as Aspect | null) ?? null,
    freqRank: r.freqRank ?? null,
    topForms: r.topForms ?? [],
    flags: r.flags ?? {},
  };
}

export function toSense(r: SenseRow): Sense {
  return {
    ord: r.ord,
    glossEn: r.glossEn,
    note: r.note ?? null,
    source: r.source as SenseSource,
    verified: r.verified,
  };
}

/** A form row as a candidate. Nouns' readings carry the noun's gender. */
export function toCandidate(r: FormLemmaRow): FormCandidate {
  return {
    lemmaId: r.lemmaId,
    lemma: r.lemma,
    pos: r.pos as Pos,
    form: r.form,
    readings: readTags(r.tags, nounGender(r.pos, r.gender)),
    freqRank: r.freqRank ?? null,
  };
}

function nounGender(pos: string, gender: string | null): Gender | undefined {
  return pos === 'noun' && gender ? (gender as Gender) : undefined;
}

// --- Lookup order ----------------------------------------------------------------

const nfc = (s: string) => s.normalize('NFC');
const lower = (s: string) => nfc(s).toLowerCase();

/**
 * How well a candidate's spelling matches the typed word: 0 exactly as typed, 1 the same
 * apart from capitals (a capitalised first word of a sentence finds its lower case form, and
 * a lower case word finds a proper name), 2 the same only after folding accents.
 */
export function matchTier(candidateForm: string, input: string): 0 | 1 | 2 {
  if (nfc(candidateForm) === nfc(input)) return 0;
  if (lower(candidateForm) === lower(input)) return 1;
  return 2;
}

const rankOf = (c: FormCandidate) => c.freqRank ?? Number.MAX_SAFE_INTEGER;

/**
 * The candidates of one input word, best first: exact spelling, then the same letters in
 * other capitals, then other accents; within a tier the more frequent lemma first.
 */
export function orderCandidates(
  candidates: readonly FormCandidate[],
  input: string,
): FormCandidate[] {
  return candidates
    .map((c, i) => ({ c, i, tier: matchTier(c.form, input) }))
    .sort(
      (a, b) =>
        a.tier - b.tier || rankOf(a.c) - rankOf(b.c) || a.c.lemmaId - b.c.lemmaId || a.i - b.i,
    )
    .map((x) => x.c);
}

/** The readings of `candidate` that match `want`, or null when it is not such a form. */
export function verifyCandidate(
  candidate: FormCandidate,
  form: string,
  want: { lemmaId?: number; case?: Case; number?: GrammaticalNumber },
): FormCandidate | null {
  if (lower(candidate.form) !== lower(form)) return null;
  if (want.lemmaId !== undefined && candidate.lemmaId !== want.lemmaId) return null;
  if (want.case === undefined && want.number === undefined) return candidate;
  const readings = candidate.readings.filter(
    (r) =>
      (want.case === undefined || r.case === want.case) &&
      (want.number === undefined || r.number === want.number),
  );
  return readings.length > 0 ? { ...candidate, readings } : null;
}

// --- Paradigm --------------------------------------------------------------------

const SLOT_ORDER = (() => {
  const order = new Map<string, number>();
  let i = 0;
  for (const n of ['s', 'p', 'x']) for (let c = 1; c <= 7; c++) order.set(`${n}${c}`, i++);
  return order;
})();

/** Sort key of a form: its first case slot (s1…s7, p1…p7, x1…x7), then the form. */
function slotOf(tags: string): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const t of splitTags(tags)) {
    const slot = SLOT_ORDER.get(t.slice(0, 2));
    if (slot !== undefined && slot < best) best = slot;
  }
  return best;
}

/** A lemma's forms as a `Paradigm`, in table order (nominative singular first). */
export function toParadigm(
  lemma: Pick<LemmaRow, 'id' | 'pos' | 'gender'>,
  rows: readonly { form: string; tags: string }[],
): Paradigm {
  const g = nounGender(lemma.pos, lemma.gender);
  const forms: FormEntry[] = [...rows]
    .sort((a, b) => slotOf(a.tags) - slotOf(b.tags) || a.form.localeCompare(b.form, 'sk'))
    .map((r) => ({ form: r.form, readings: readTags(r.tags, g) }));
  return { lemmaId: lemma.id, forms };
}

export type TableColumn = 'sg' | 'pl' | 'x';

/** One table of forms: cases as rows, singular and plural (or `x`, no number) as columns. */
export interface FormTable {
  /** The gender of an agreeing word's table; null for nouns and pronouns without gender. */
  gender: Gender | null;
  /** The columns that hold at least one form, in the order sg, pl, x. */
  columns: TableColumn[];
  /** The cases that hold at least one form, in school order (nom … ins). */
  rows: { case: Case; cells: Record<TableColumn, string[]> }[];
}

/**
 * The tables of a paradigm: one for a noun or a pronoun, one per gender for an adjective,
 * pronoun or numeral that agrees (tags with a gender), none for a word without case forms
 * (verbs, adverbs). A cell lists every form of that slot (*človeku*, *človekovi*).
 */
export function buildFormTables(paradigm: Paradigm): FormTable[] {
  const byGender = new Map<Gender | null, Map<Case, Record<TableColumn, string[]>>>();
  let agreeing = false;
  for (const entry of paradigm.forms) {
    for (const r of entry.readings) {
      if (!r.case) continue;
      // Agreeing tags carry their gender in the tag (`p4f`); a noun's readings carry the
      // noun's own gender, which is no reason for a table per gender.
      const tagGender = /^[sp][1-7][mifn]$/u.test(r.tag) ? (r.gender ?? null) : null;
      if (tagGender) agreeing = true;
      const col: TableColumn = r.number ?? 'x';
      let rows = byGender.get(tagGender);
      if (!rows) {
        rows = new Map();
        byGender.set(tagGender, rows);
      }
      let cells = rows.get(r.case);
      if (!cells) {
        cells = { sg: [], pl: [], x: [] };
        rows.set(r.case, cells);
      }
      if (!cells[col].includes(entry.form)) cells[col].push(entry.form);
    }
  }
  const order: (Gender | null)[] = agreeing ? [...GENDERS] : [null];
  const tables: FormTable[] = [];
  for (const g of order) {
    const rows = byGender.get(g);
    if (!rows) continue;
    const columns = (['sg', 'pl', 'x'] as const).filter((col) =>
      [...rows.values()].some((cells) => cells[col].length > 0),
    );
    tables.push({
      gender: g,
      columns,
      rows: CASES.filter((c) => rows.has(c)).map((c) => ({
        case: c,
        cells: rows.get(c) as Record<TableColumn, string[]>,
      })),
    });
  }
  return tables;
}

// --- Glosses (route reader.gloss) ------------------------------------------------

/** The most glosses stored per lemma, and the longest gloss. */
export const MAX_GLOSSES = 3;
export const MAX_GLOSS_LENGTH = 80;

const GlossTextSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(MAX_GLOSS_LENGTH));

/** The answer of `reader.gloss`. */
export const GlossAnswerSchema = z.object({
  glosses: z.array(
    z.object({
      lemmaId: z.int(),
      glosses: z.array(GlossTextSchema).min(1),
    }),
  ),
});
export type GlossAnswer = z.infer<typeof GlossAnswerSchema>;

/** The structured request for the glosses of `lemmas` (one call for all of them). */
export function glossRequest(
  lemmas: readonly Lemma[],
  userId: string,
  sentenceSk?: string,
): StructuredRequest<GlossAnswer> {
  const input = {
    lemmas: lemmas.map((l) => ({
      lemmaId: l.id,
      lemma: l.lemma,
      pos: l.pos,
      ...(l.gender ? { gender: l.gender } : {}),
      ...(l.aspect ? { aspect: l.aspect } : {}),
    })),
    ...(sentenceSk ? { sentence: sentenceSk } : {}),
  };
  return {
    route: 'reader.gloss',
    userId,
    system: [...currentVersion(PROMPTS['reader.gloss']).system],
    messages: [{ role: 'user', content: JSON.stringify(input) }],
    schema: GlossAnswerSchema,
    maxTokens: 200 + 60 * lemmas.length,
  };
}

/**
 * The glosses to store from an answer: only lemmas that were asked, each at most once, up to
 * MAX_GLOSSES distinct glosses, numbered from `ord` 0.
 */
export function glossesToStore(
  answer: GlossAnswer,
  asked: ReadonlySet<number>,
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const entry of answer.glosses) {
    if (!asked.has(entry.lemmaId) || out.has(entry.lemmaId)) continue;
    const unique = [...new Set(entry.glosses)].slice(0, MAX_GLOSSES);
    out.set(entry.lemmaId, unique);
  }
  return out;
}

// --- Cache -----------------------------------------------------------------------

/**
 * A small least recently used cache. Reference data changes only with a content load, which
 * runs between deploys, so entries never expire on their own; `clear()` drops them.
 */
export class LruCache<K, V> {
  readonly #max: number;
  readonly #map = new Map<K, V>();
  constructor(max: number) {
    this.#max = Math.max(0, Math.floor(max));
  }
  get size(): number {
    return this.#map.size;
  }
  get(key: K): V | undefined {
    const v = this.#map.get(key);
    if (v === undefined) return undefined;
    // Move to the most recent end.
    this.#map.delete(key);
    this.#map.set(key, v);
    return v;
  }
  set(key: K, value: V): void {
    if (this.#max === 0) return;
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next();
      if (oldest.done) break;
      this.#map.delete(oldest.value);
    }
  }
  clear(): void {
    this.#map.clear();
  }
}
