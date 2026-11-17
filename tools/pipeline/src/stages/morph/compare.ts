// Compares the forms of a reference set (the mini dataset) with the forms built from SNK.
import type { FormOut } from './build';

export interface FormDiff {
  lemmaId: number;
  form: string;
  /** Tags in the reference; null when the reference lacks the form. */
  expected: string | null;
  /** Tags in the built data; null when the build lacks the form. */
  actual: string | null;
}

/** Every form whose presence or tags differ, for the lemma ids of the reference. */
export function compareForms(reference: readonly FormOut[], built: readonly FormOut[]): FormDiff[] {
  const ids = new Set(reference.map((r) => r.lemmaId));
  const key = (r: FormOut) => `${r.lemmaId}\t${r.form}`;
  const norm = (tags: string) => tags.split(' ').filter(Boolean).sort().join(' ');
  const ref = new Map(reference.map((r) => [key(r), r]));
  const got = new Map(built.filter((r) => ids.has(r.lemmaId)).map((r) => [key(r), r]));
  const diffs: FormDiff[] = [];
  for (const [k, r] of ref) {
    const b = got.get(k);
    if (!b) diffs.push({ lemmaId: r.lemmaId, form: r.form, expected: r.tags, actual: null });
    else if (norm(b.tags) !== norm(r.tags))
      diffs.push({ lemmaId: r.lemmaId, form: r.form, expected: r.tags, actual: b.tags });
  }
  for (const [k, b] of got)
    if (!ref.has(k))
      diffs.push({ lemmaId: b.lemmaId, form: b.form, expected: null, actual: b.tags });
  return diffs.sort(
    (a, b) => a.lemmaId - b.lemmaId || (a.form < b.form ? -1 : a.form > b.form ? 1 : 0),
  );
}

/** A small seeded generator (mulberry32), so samples in reports are the same on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks `n` items without repetition, in a stable order. */
export function sample<T>(items: readonly T[], n: number, seed: number): T[] {
  const rnd = seededRandom(seed);
  const idx = items.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j] as number, idx[i] as number];
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => items[i] as T);
}
