// The words the sentences stage knows: lemmas with their rank and most used forms, and the
// readings (lemma and form tag) of every written form it needs. Read from the morph and
// freq outputs, or from one content set folder (the mini dataset) with `--lexicon`.
import { join } from 'node:path';
import type { Case, Gender, Pos } from '@app/contracts';
import { splitTags } from '@app/ling';
import { existsSync, readJsonl } from '../../lib/files';

export interface LexLemma {
  id: number;
  key: string;
  lemma: string;
  pos: Pos;
  gender?: Gender;
  freqRank?: number;
  topForms: { form: string; tag: string }[];
  /** Cases a preposition governs (morph's `flags.cases`, or the set's triggers). */
  cases?: Case[];
}

/** One reading of a written form: a lemma and one form tag. */
export interface Reading {
  lemmaId: number;
  tag: string;
  /** The form as the morphology writes it (capitals kept). */
  form: string;
}

/**
 * Names that start sentences and are spelled like a common word: Tatoeba's stock name *Tom*
 * would otherwise pass as *tom*, a form of *ten*. Inside a sentence the capital tells.
 */
const NAMES: ReadonlySet<string> = new Set(['Tom']);

const UPPER = /^\p{Lu}/u;
const LOWER = /^\p{Ll}/u;

export class Lexicon {
  readonly lemmas = new Map<number, LexLemma>();
  readonly byLower = new Map<string, Reading[]>();

  /** `top`: a word counts as common when its lemma's rank is at most this. */
  constructor(readonly top: number) {}

  addLemma(l: LexLemma): void {
    this.lemmas.set(l.id, l);
  }

  addForm(lemmaId: number, form: string, tags: string): void {
    const key = form.toLowerCase();
    let list = this.byLower.get(key);
    if (!list) {
      list = [];
      this.byLower.set(key, list);
    }
    const parts = splitTags(tags);
    for (const tag of parts.length > 0 ? parts : ['']) {
      if (!list.some((r) => r.lemmaId === lemmaId && r.tag === tag && r.form === form))
        list.push({ lemmaId, tag, form });
    }
  }

  /**
   * The readings of a word as written. A capitalised word inside a sentence is a name and
   * matches only forms written with a capital (so *Tom* is not *tom*, a form of *ten*); a
   * small letter matches only forms written small; the first word of a sentence matches both.
   */
  readings(word: string, initial: boolean): Reading[] {
    if (initial && NAMES.has(word)) return [];
    const all = this.byLower.get(word.toLowerCase()) ?? [];
    if (LOWER.test(word)) return all.filter((r) => !UPPER.test(r.form));
    if (!initial && UPPER.test(word)) return all.filter((r) => UPPER.test(r.form));
    return all;
  }

  rankOf(lemmaId: number): number | undefined {
    return this.lemmas.get(lemmaId)?.freqRank;
  }

  /** Ranked within the top: the words a sentence may use. */
  common(lemmaId: number): boolean {
    const r = this.rankOf(lemmaId);
    return r !== undefined && r <= this.top;
  }

  /** Whether (form, tag) is one of the lemma's most used forms. A lemma without any accepts all. */
  isTopForm(lemmaId: number, form: string, tag: string): boolean {
    const l = this.lemmas.get(lemmaId);
    if (!l || l.topForms.length === 0) return true;
    const f = form.toLowerCase();
    return l.topForms.some((t) => t.tag === tag && t.form.toLowerCase() === f);
  }

  /** The lemmas ranked within the top, best rank first. */
  ranked(): LexLemma[] {
    return [...this.lemmas.values()]
      .filter((l) => l.freqRank !== undefined && l.freqRank <= this.top)
      .sort((a, b) => (a.freqRank as number) - (b.freqRank as number) || a.id - b.id);
  }
}

interface RawLemma {
  id: number;
  key: string;
  lemma: string;
  pos: Pos;
  gender?: Gender;
  freqRank?: number;
  topForms?: { form: string; tag: string }[];
  flags?: { retired?: boolean; cases?: Case[] };
}

export interface LexiconFiles {
  lemmas: string;
  forms: string;
  /** Ranks and top forms by id (freq's output); absent when `lemmas` carries them. */
  ranks?: string;
  /** The set's triggers, for the cases of prepositions without `flags.cases`. */
  triggers?: string;
}

/** The lexicon files of a set folder (the mini dataset), or of the morph and freq builds. */
export function lexiconFiles(build: string, setDir?: string): LexiconFiles {
  if (setDir)
    return {
      lemmas: join(setDir, 'lemmas.jsonl'),
      forms: join(setDir, 'forms.jsonl'),
      triggers: join(setDir, 'triggers.jsonl'),
    };
  return {
    lemmas: join(build, 'morph', 'lemmas.jsonl'),
    forms: join(build, 'morph', 'forms.jsonl'),
    ranks: join(build, 'freq', 'lemmas.jsonl'),
  };
}

/**
 * Loads the lexicon. Only the forms a sentence can use are kept: those whose lower case
 * spelling is in `words`, and every form of a lemma ranked within the top (what a
 * generated sentence may use).
 */
export async function loadLexicon(
  files: LexiconFiles,
  top: number,
  words?: ReadonlySet<string>,
): Promise<Lexicon> {
  const lex = new Lexicon(top);
  const ranks = new Map<
    number,
    { freqRank?: number; topForms?: { form: string; tag: string }[] }
  >();
  if (files.ranks) for await (const r of readJsonl<RawLemma>(files.ranks)) ranks.set(r.id, r);
  for await (const l of readJsonl<RawLemma>(files.lemmas)) {
    if (l.flags?.retired) continue;
    const r = ranks.get(l.id) ?? l;
    const lemma: LexLemma = {
      id: l.id,
      key: l.key,
      lemma: l.lemma,
      pos: l.pos,
      topForms: (r.topForms ?? []).map((t) => ({ form: t.form, tag: t.tag })),
    };
    if (l.gender) lemma.gender = l.gender;
    if (r.freqRank !== undefined) lemma.freqRank = r.freqRank;
    if (l.flags?.cases && l.flags.cases.length > 0) lemma.cases = [...l.flags.cases];
    lex.addLemma(lemma);
  }
  if (files.triggers && existsSync(files.triggers))
    for await (const t of readJsonl<{ kind: string; lemmaId?: number; case: Case }>(
      files.triggers,
    )) {
      if (t.kind !== 'preposition' || t.lemmaId === undefined) continue;
      const l = lex.lemmas.get(t.lemmaId);
      if (l?.pos !== 'prep') continue;
      l.cases = [...new Set([...(l.cases ?? []), t.case])];
    }
  for await (const f of readJsonl<{ lemmaId: number; form: string; tags: string }>(files.forms)) {
    if (!lex.lemmas.has(f.lemmaId)) continue;
    if (words && !words.has(f.form.toLowerCase()) && !lex.common(f.lemmaId)) continue;
    lex.addForm(f.lemmaId, f.form, f.tags);
  }
  return lex;
}
