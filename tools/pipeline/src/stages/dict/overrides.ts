// The editor's list of dictionary entries: content/authored/glosses/overrides.yaml, a list
// of `{ key, glosses, why }`. Wiktionary gives the senses of a word in its own order (the
// Sabbath before Saturday for `sobota`), files a function word under another part of speech
// and has glosses that the stage must cut; a generated gloss can be wrong as well. The entry
// of a lemma that the list names shows exactly the glosses of the list, in its order. A gloss
// the entry already had keeps its source; a new one has the source `manual`.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SenseSource } from '@app/contracts';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { existsSync } from '../../lib/files';
import type { Paths } from '../../lib/paths';
import { MAX_GLOSS_LENGTH, MAX_SENSES, type Sense } from './wiktionary';

/** Notes stand under the gloss on a card: one short line. */
export const MAX_NOTE_LENGTH = 80;

const gloss = z.string().trim().min(1).max(MAX_GLOSS_LENGTH);
const OverrideSchema = z.strictObject({
  /** The key of the lemma in morph/lemmas.jsonl: `sobota|noun|f|1`. */
  key: z.string().min(1),
  /** What the entry shows, the most common meaning first: a gloss, or a gloss with its note. */
  glosses: z
    .array(
      z.union([
        gloss,
        z.strictObject({ gloss, note: z.string().trim().min(1).max(MAX_NOTE_LENGTH).optional() }),
      ]),
    )
    .min(1)
    .max(MAX_SENSES),
  /** Why the entry differs from its source, for the next editor. */
  why: z.string().min(1),
});

export interface GlossOverride {
  key: string;
  glosses: Sense[];
  why: string;
}

/** A sense with where it comes from. */
export type SourcedSense = Sense & { source: SenseSource };

export const overridesPath = (paths: Paths) =>
  join(paths.content, 'authored', 'glosses', 'overrides.yaml');

/** The list by lemma key; empty when the file does not exist. A key may stand once. */
export async function readOverrides(path: string): Promise<Map<string, GlossOverride>> {
  const out = new Map<string, GlossOverride>();
  if (!existsSync(path)) return out;
  const parsed = z.array(OverrideSchema).safeParse(parseYaml(await readFile(path, 'utf8')) ?? []);
  if (!parsed.success)
    throw new Error(
      `${path}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'list'}: ${i.message}`).join('; ')}`,
    );
  for (const e of parsed.data) {
    const key = e.key.normalize('NFC');
    if (out.has(key)) throw new Error(`${path}: the key ${key} stands twice`);
    const glosses = e.glosses.map((g): Sense => {
      if (typeof g === 'string') return { glossEn: g };
      return g.note ? { glossEn: g.gloss, note: g.note } : { glossEn: g.gloss };
    });
    const seen = new Set<string>();
    for (const g of glosses) {
      const k = g.glossEn.toLowerCase();
      if (seen.has(k)) throw new Error(`${path}: ${key} lists the gloss "${g.glossEn}" twice`);
      seen.add(k);
    }
    out.set(key, { key, glosses, why: e.why });
  }
  return out;
}

/**
 * The entry of a lemma after its override: the glosses of the list in the list's order, each
 * with the note the list gives it (none when it gives none). A gloss the entry already had
 * keeps its source, and so does any other sense of the lemma's Wiktionary entries
 * (`wiktionary`): a Wiktionary sense stays one when it only moves or comes into view.
 */
export function applyOverride(
  o: GlossOverride,
  current: readonly SourcedSense[],
  wiktionary: readonly Sense[] = [],
): SourcedSense[] {
  return o.glosses.map((g) => {
    const had = current.find((s) => s.glossEn === g.glossEn);
    const source =
      had?.source ?? (wiktionary.some((s) => s.glossEn === g.glossEn) ? 'wiktionary' : 'manual');
    return { ...g, source };
  });
}
