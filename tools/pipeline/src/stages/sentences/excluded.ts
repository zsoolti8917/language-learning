// Real sentences that must not reach learners: content/authored/sentences/excluded.yaml, a
// list of `{ text, reason }`. The rules of the stage check length, vocabulary and forms; they
// cannot see that a sentence of a source is wrong Slovak. A reader who finds one adds it here.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { existsSync } from '../../lib/files';
import type { Paths } from '../../lib/paths';

const ExcludedSchema = z.array(
  z.strictObject({ text: z.string().min(1), reason: z.string().min(1) }),
);

export const excludedPath = (paths: Paths) =>
  join(paths.content, 'authored', 'sentences', 'excluded.yaml');

/** The excluded texts with their reasons; empty when the file does not exist. */
export async function readExcluded(path: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  const parsed = ExcludedSchema.safeParse(parseYaml(await readFile(path, 'utf8')) ?? []);
  if (!parsed.success)
    throw new Error(
      `${path}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'list'}: ${i.message}`).join('; ')}`,
    );
  for (const e of parsed.data) out.set(e.text.normalize('NFC').trim(), e.reason);
  return out;
}
