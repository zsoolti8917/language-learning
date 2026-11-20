// English translations an editor corrected: content/authored/sentences/translations.yaml, a
// list of `{ text, en, reason }`. A real sentence can be good Slovak beside an English
// sentence that says something else: a Tatoeba pair made through a third language ("here"
// for *tam*), or a loose translation that hides the very word the sentence is shown for.
// The rules of the stage cannot see that. A reader who finds one writes the English that
// learners see here; the Slovak text stays as its source has it.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { existsSync } from '../../lib/files';
import type { Paths } from '../../lib/paths';

const CorrectedSchema = z.array(
  z.strictObject({ text: z.string().min(1), en: z.string().min(1), reason: z.string().min(1) }),
);

export const correctedPath = (paths: Paths) =>
  join(paths.content, 'authored', 'sentences', 'translations.yaml');

/** The corrected English by Slovak text; empty when the file does not exist. */
export async function readCorrected(path: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  const parsed = CorrectedSchema.safeParse(parseYaml(await readFile(path, 'utf8')) ?? []);
  if (!parsed.success)
    throw new Error(
      `${path}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'list'}: ${i.message}`).join('; ')}`,
    );
  for (const e of parsed.data) {
    const text = e.text.normalize('NFC').trim();
    if (out.has(text)) throw new Error(`${path}: "${text}" is listed twice`);
    out.set(text, e.en.trim());
  }
  return out;
}
