// The morphology the C4 stages (triggers, lessons, exercises) read: lemmas with their ranks
// and flags, the forms of the lemmas a stage asks for, and an index of every known word form.
//
// By default it is the full build: content/build/morph/{lemmas,forms}.jsonl with the ranks
// of content/build/freq/lemmas.jsonl merged in. `--morph <dir>` reads a content set folder
// instead (lemmas.jsonl and forms.jsonl with ranks inline), such as the mini dataset; such a
// run is not complete, so missing words are warnings there instead of errors.
import { join } from 'node:path';
import type { FormMap, Gender, Pos } from '@app/contracts';
import { formKey, tokenize } from '@app/ling';
import { existsSync, readJsonl } from '../../lib/files';
import type { Paths } from '../../lib/paths';
import { type ArgValue, resolveArg, type StageContext } from '../../lib/runner';

export interface MorphLemma {
  id: number;
  key: string;
  lemma: string;
  pos: Pos;
  gender?: Gender;
  pattern?: string;
  freqRank?: number;
  topForms?: { form: string; tag: string; share: number }[];
  flags: Record<string, unknown>;
}

/** What the morphology knows of one spelling (lower case), over all its lemmas. */
export interface WordInfo {
  /** The best frequency rank of its lemmas; Infinity when none is ranked. */
  rank: number;
  /** Bit `1 << n` is set when one of its tags has case digit n (1 nom ... 7 ins). */
  cases: number;
  /** True when every lemma of the spelling is a proper name. */
  properOnly: boolean;
}

export interface Morphology {
  /** The full build (default inputs); false for a `--morph` folder such as the mini dataset. */
  complete: boolean;
  /** Where it was read from, for messages. */
  source: string;
  lemmas: Map<number, MorphLemma>;
  byKey: Map<string, number>;
  /** Lemma text → ids. */
  byLemma: Map<string, number[]>;
  /** Form maps of the lemmas the loader was asked for. */
  forms: Map<number, FormMap>;
  /** Every spelling of every lemma, by `formKey`. Present when asked for. */
  words: Map<string, WordInfo>;
}

export interface MorphFiles {
  lemmas: string;
  forms: string;
  /** Ranks merged by id (C2's freq output); absent with --morph. */
  ranks?: string;
  /** C2's ranks.tsv (web scores), for corpus weights; absent with --morph. */
  ranksTsv?: string;
  complete: boolean;
}

const base = () => process.env.INIT_CWD ?? process.cwd();

/** The `--morph <dir>` option of the C4 stages. */
export const MORPH_OPTION = { morph: { type: 'string' as const } };

export function morphDirOf(args: Record<string, ArgValue>): string | undefined {
  return resolveArg(args.morph, base());
}

export function morphFiles(ctx: Pick<StageContext, 'paths' | 'args'>): MorphFiles {
  const dir = morphDirOf(ctx.args);
  if (dir)
    return {
      lemmas: join(dir, 'lemmas.jsonl'),
      forms: join(dir, 'forms.jsonl'),
      complete: false,
    };
  return defaultMorphFiles(ctx.paths);
}

export function defaultMorphFiles(paths: Paths): MorphFiles {
  return {
    lemmas: join(paths.build, 'morph', 'lemmas.jsonl'),
    forms: join(paths.build, 'morph', 'forms.jsonl'),
    ranks: join(paths.build, 'freq', 'lemmas.jsonl'),
    ranksTsv: join(paths.build, 'freq', 'ranks.tsv'),
    complete: true,
  };
}

/** The files of `morphFiles` that exist, for a stage's inputs. */
export function morphInputs(files: MorphFiles): string[] {
  return [files.lemmas, files.forms, files.ranks, files.ranksTsv].filter(
    (p): p is string => p !== undefined,
  );
}

const CASE_DIGIT = /^[spx]([1-7])/u;

/** The case bits of a list of tags (see WordInfo.cases). */
export function caseBits(tags: string): number {
  let bits = 0;
  for (const t of tags.split(' ')) {
    const m = CASE_DIGIT.exec(t);
    if (m) bits |= 1 << Number(m[1]);
  }
  return bits;
}

export interface LoadOptions {
  /** Load the form map of these lemmas. */
  formsFor?: (l: MorphLemma) => boolean;
  /** Build the index of every spelling. */
  words?: boolean;
}

export async function loadMorphology(files: MorphFiles, opts: LoadOptions = {}): Promise<Morphology> {
  for (const p of [files.lemmas, files.forms])
    if (!existsSync(p))
      throw new Error(
        `${p} does not exist. Run morph and freq first, or pass --morph <a content set folder>.`,
      );
  const lemmas = new Map<number, MorphLemma>();
  const byKey = new Map<string, number>();
  const byLemma = new Map<string, number[]>();
  for await (const r of readJsonl<MorphLemma>(files.lemmas)) {
    if (r.flags?.retired) continue;
    const l: MorphLemma = { ...r, flags: r.flags ?? {} };
    lemmas.set(l.id, l);
    byKey.set(l.key, l.id);
    const list = byLemma.get(l.lemma);
    if (list) list.push(l.id);
    else byLemma.set(l.lemma, [l.id]);
  }
  if (files.ranks && existsSync(files.ranks))
    for await (const r of readJsonl<{ id: number; freqRank: number; topForms?: MorphLemma['topForms'] }>(
      files.ranks,
    )) {
      const l = lemmas.get(r.id);
      if (!l) continue;
      l.freqRank = r.freqRank;
      if (r.topForms) l.topForms = r.topForms;
    }
  const forms = new Map<number, FormMap>();
  const words = new Map<string, WordInfo>();
  const wanted = new Set<number>();
  if (opts.formsFor) for (const l of lemmas.values()) if (opts.formsFor(l)) wanted.add(l.id);
  if (wanted.size > 0 || opts.words)
    for await (const r of readJsonl<{ lemmaId: number; form: string; tags: string }>(files.forms)) {
      const l = lemmas.get(r.lemmaId);
      if (!l) continue;
      const key = formKey(r.form);
      if (wanted.has(r.lemmaId)) {
        let map = forms.get(r.lemmaId);
        if (!map) {
          map = {};
          forms.set(r.lemmaId, map);
        }
        const list = map[key] ?? [];
        for (const t of r.tags.split(' ')) if (t !== '' && !list.includes(t)) list.push(t);
        map[key] = list;
      }
      if (opts.words) {
        const rank = l.freqRank ?? Number.POSITIVE_INFINITY;
        const proper = l.flags.proper === true;
        const w = words.get(key);
        if (w) {
          w.rank = Math.min(w.rank, rank);
          w.cases |= caseBits(r.tags);
          w.properOnly &&= proper;
        } else words.set(key, { rank, cases: caseBits(r.tags), properOnly: proper });
      }
    }
  return {
    complete: files.complete,
    source: files.lemmas,
    lemmas,
    byKey,
    byLemma,
    forms,
    words,
  };
}

/** A lemma by its text and part of speech (and gender for nouns); the best ranked wins. */
export function findLemma(
  m: Morphology,
  lemma: string,
  pos: readonly Pos[],
  gender?: Gender,
): MorphLemma | undefined {
  const found = (m.byLemma.get(lemma) ?? [])
    .map((id) => m.lemmas.get(id) as MorphLemma)
    .filter((l) => pos.includes(l.pos) && (gender === undefined || l.gender === gender));
  found.sort(
    (a, b) =>
      pos.indexOf(a.pos) - pos.indexOf(b.pos) ||
      (a.freqRank ?? Number.POSITIVE_INFINITY) - (b.freqRank ?? Number.POSITIVE_INFINITY) ||
      a.id - b.id,
  );
  return found[0];
}

/** The forms of a form map that carry a tag, in a stable order. */
export function formsWith(map: FormMap | undefined, tag: string): string[] {
  if (!map) return [];
  return Object.keys(map)
    .filter((f) => map[f]?.includes(tag))
    .sort();
}

/** The words of a text (the tokenizer of @app/ling), with their offsets. */
export function wordsOf(text: string): { w: string; s: number; e: number }[] {
  return tokenize(text)
    .filter((t) => t.t === 'word')
    .map((t) => ({ w: text.slice(t.s, t.e), s: t.s, e: t.e }));
}

export const CASE_DIGITS = {
  nom: 1,
  gen: 2,
  dat: 3,
  acc: 4,
  voc: 5,
  loc: 6,
  ins: 7,
} as const;
