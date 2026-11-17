// The sentences sample: real Tatoeba and treebank sentences cut by fixtures/make-sample.py to
// those the mini dataset can tokenize (and some with one rare word). Tests copy it into a
// temporary root, where `sentences --lexicon <mini>` reads it.
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Paths } from '../../lib/paths';
import { TATOEBA_FILES, TATOEBA_SOURCE, UD_SOURCE, UD_SPLITS, udFile } from './harvest';

export const SENTENCE_FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

export async function seedSentencesSample(paths: Paths): Promise<void> {
  const tat = join(paths.raw, TATOEBA_SOURCE);
  const ud = join(paths.raw, UD_SOURCE);
  await mkdir(tat, { recursive: true });
  await mkdir(ud, { recursive: true });
  for (const f of Object.values(TATOEBA_FILES))
    await copyFile(join(SENTENCE_FIXTURES, 'tatoeba', f), join(tat, f));
  for (const s of UD_SPLITS)
    await copyFile(join(SENTENCE_FIXTURES, 'ud', udFile(s)), join(ud, udFile(s)));
}
