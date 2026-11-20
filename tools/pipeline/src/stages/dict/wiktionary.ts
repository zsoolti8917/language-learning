// Reads the kaikki.org Wiktionary extract and keeps up to three short senses per lemma.
// An entry matches a lemma by spelling and part of speech (and by gender for nouns when the
// spelling has several noun lemmas). Senses that only point at another word ("genitive of
// mesto", "alternative form of") are skipped; archaic, rare and vulgar senses go last.
import type { Pos } from '@app/contracts';

export const MAX_SENSES = 3;
export const MAX_GLOSS_LENGTH = 60;

/** kaikki part of speech → ours. Others (character, phrase, prefix, suffix …) are skipped. */
export const KAIKKI_POS: Readonly<Record<string, Pos>> = {
  noun: 'noun',
  name: 'noun',
  adj: 'adj',
  verb: 'verb',
  adv: 'adv',
  num: 'num',
  pron: 'pron',
  det: 'pron',
  prep: 'prep',
  conj: 'conj',
  particle: 'part',
  intj: 'intj',
};

/**
 * Where SNK and Wiktionary file a word under different parts of speech (kde, ako, už; prvý
 * as a numeral or an adjective; iný as a pronoun or an adjective): the kaikki classes a
 * lemma may take when no entry has its own class.
 */
const LOOSE: Readonly<Partial<Record<Pos, ReadonlySet<Pos>>>> = (() => {
  const fn = new Set<Pos>(['adv', 'part', 'conj', 'intj', 'pron']);
  return {
    adv: fn,
    part: fn,
    conj: fn,
    intj: fn,
    other: fn,
    pron: new Set<Pos>(['pron', 'adj', 'num', 'adv']),
    num: new Set<Pos>(['num', 'adj', 'pron']),
  };
})();

const SKIP_TAGS = new Set(['form-of', 'alt-of', 'misspelling', 'abbreviation', 'initialism']);
const LATE_TAGS = new Set([
  'archaic',
  'obsolete',
  'dated',
  'rare',
  'vulgar',
  'offensive',
  'derogatory',
  'dialectal',
  'regional',
  'historical',
  'nonstandard',
  'slang',
]);

export interface KaikkiSense {
  glosses?: string[];
  raw_glosses?: string[];
  tags?: string[];
  form_of?: unknown;
  alt_of?: unknown;
}

export interface KaikkiEntry {
  word: string;
  pos: string;
  lang_code?: string;
  head_templates?: { name?: string; args?: Record<string, string> }[];
  senses?: KaikkiSense[];
}

export interface Sense {
  glossEn: string;
  note?: string;
}

export interface DictEntry {
  word: string;
  pos: Pos;
  /** kaikki entry pos, before mapping (`name`, `det` …). */
  kaikkiPos: string;
  gender?: string;
  senses: Sense[];
}

/** The noun gender of an entry from its head template (`m-an`, `m-in`, `f`, `n`). */
export function genderOf(e: KaikkiEntry): string | undefined {
  for (const h of e.head_templates ?? []) {
    const g = h.args?.['1'] ?? h.args?.g;
    if (!g) continue;
    if (/^m-?(an|pr)/u.test(g)) return 'm_anim';
    if (/^m-?in/u.test(g)) return 'm_inan';
    if (/^f/u.test(g)) return 'f';
    if (/^n/u.test(g)) return 'n';
  }
  return undefined;
}

/**
 * Shortens a gloss: drops a trailing "[…]" usage note and parenthesised explanations, which
 * it returns apart ("to make (to create from a certain material)" → "to make"). A gloss that
 * is only a parenthesis keeps it. Still too long: cut at the first semicolon, then hard.
 */
export function shortGloss(text: string): { gloss: string; explanation?: string } {
  const plain = text.replace(/\s*\[[^\]]*\]\s*$/u, '').trim();
  const parens = [...plain.matchAll(/\(([^)]*)\)/gu)].map((m) => (m[1] as string).trim());
  let g = plain
    .replace(/\s*\([^)]*\)/gu, '')
    .replace(/\s+([,;])/gu, '$1')
    .trim();
  let explanation: string | undefined = parens.filter(Boolean).join('; ') || undefined;
  if (!g) {
    g = plain;
    explanation = undefined;
  }
  if (g.length > MAX_GLOSS_LENGTH) g = (g.split(/;\s*/u)[0] as string).trim();
  if (g.length > MAX_GLOSS_LENGTH) g = `${g.slice(0, MAX_GLOSS_LENGTH - 1).trimEnd()}…`;
  g = g.replace(/[.,;:\s]+$/u, '');
  return explanation ? { gloss: g, explanation } : { gloss: g };
}

/** The qualifier of a raw gloss, "(with locative) on" → "with locative". */
export function noteOf(raw: string | undefined, gloss: string): string | undefined {
  if (!raw || raw === gloss) return undefined;
  const m = /^\(([^)]+)\)\s/u.exec(raw);
  return m ? (m[1] as string).trim() : undefined;
}

/** The senses of one entry worth showing, best first, at most MAX_SENSES. */
export function sensesOf(e: KaikkiEntry): Sense[] {
  const out: { s: Sense; late: boolean; i: number }[] = [];
  const seen = new Set<string>();
  (e.senses ?? []).forEach((s, i) => {
    const tags = s.tags ?? [];
    if (s.form_of || s.alt_of || tags.some((t) => SKIP_TAGS.has(t))) return;
    const glosses = s.glosses ?? [];
    const last = glosses[glosses.length - 1];
    if (!last) return;
    const { gloss: glossEn, explanation } = shortGloss(last);
    if (!glossEn) return;
    const k = glossEn.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    const raw = s.raw_glosses?.[s.raw_glosses.length - 1];
    const note = noteOf(raw, last) ?? explanation;
    out.push({
      s: note ? { glossEn, note } : { glossEn },
      late: tags.some((t) => LATE_TAGS.has(t)),
      i,
    });
  });
  out.sort((a, b) => Number(a.late) - Number(b.late) || a.i - b.i);
  return out.map((x) => x.s);
}

/** Parses one JSONL line of the extract into an entry with senses, or null. */
export function parseEntry(e: KaikkiEntry): DictEntry | null {
  if (e.lang_code && e.lang_code !== 'sk') return null;
  const pos = KAIKKI_POS[e.pos];
  if (!pos || !e.word) return null;
  const senses = sensesOf(e);
  if (senses.length === 0) return null;
  const gender = pos === 'noun' ? genderOf(e) : undefined;
  return { word: e.word, pos, kaikkiPos: e.pos, ...(gender ? { gender } : {}), senses };
}

export interface MatchLemma {
  id: number;
  lemma: string;
  pos: Pos;
  gender?: string;
}

export interface MatchResult {
  /** lemma id → senses (at most MAX_SENSES), from all matching entries in file order. */
  senses: Map<number, Sense[]>;
  /** lemma id → every usable sense of the matching entries, also those past MAX_SENSES. */
  all: Map<number, Sense[]>;
  /** lemma id → how it matched */
  how: Map<number, 'exact' | 'loose'>;
}

/**
 * Matches entries to lemmas. Exact: same spelling and part of speech; a noun entry with a
 * gender goes to the noun lemma of that gender when there is one. Loose (only for lemmas
 * with no exact match): same spelling, a related class (LOOSE).
 */
export function matchEntries(
  lemmas: Iterable<MatchLemma>,
  entries: readonly DictEntry[],
): MatchResult {
  const byWordPos = new Map<string, DictEntry[]>();
  const byWord = new Map<string, DictEntry[]>();
  for (const e of entries) {
    const k = `${e.word}\t${e.pos}`;
    byWordPos.set(k, [...(byWordPos.get(k) ?? []), e]);
    byWord.set(e.word, [...(byWord.get(e.word) ?? []), e]);
  }
  const lemmaList = [...lemmas];
  const nounGenders = new Map<string, Set<string>>();
  for (const l of lemmaList)
    if (l.pos === 'noun' && l.gender) {
      const s = nounGenders.get(l.lemma) ?? new Set<string>();
      s.add(l.gender);
      nounGenders.set(l.lemma, s);
    }
  const senses = new Map<number, Sense[]>();
  const all = new Map<number, Sense[]>();
  const how = new Map<number, 'exact' | 'loose'>();
  const add = (id: number, list: DictEntry[], kind: 'exact' | 'loose') => {
    const out: Sense[] = [];
    const seen = new Set<string>();
    for (const e of list)
      for (const s of e.senses) {
        const k = s.glossEn.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
      }
    if (out.length > 0) {
      senses.set(id, out.slice(0, MAX_SENSES));
      all.set(id, out);
      how.set(id, kind);
    }
  };
  for (const l of lemmaList) {
    let list = byWordPos.get(`${l.lemma}\t${l.pos}`) ?? [];
    if (l.pos === 'noun' && list.length > 0) {
      const genders = nounGenders.get(l.lemma);
      if (genders && genders.size > 1)
        list = list.filter((e) => !e.gender || e.gender === l.gender);
    }
    if (list.length > 0) {
      add(l.id, list, 'exact');
      continue;
    }
    const accept = LOOSE[l.pos];
    if (!accept) continue;
    const loose = (byWord.get(l.lemma) ?? []).filter((e) => accept.has(e.pos));
    if (loose.length > 0) add(l.id, loose, 'loose');
  }
  return { senses, all, how };
}
