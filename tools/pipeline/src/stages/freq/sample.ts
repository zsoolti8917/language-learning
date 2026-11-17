// The freq and dict sample: the real data cut down to the lemmas that rank in the top 60 of
// the full run, every lemma whose web or subtitle rank is as high as theirs, and every
// lemma that shares a spelling with them (so ambiguous forms split as in the full run).
// With these inputs the top 67 of the ranking equal the full run's, scores included. Built
// by fixtures/make-sample.py from content/raw and content/build; tests copy it into a
// temporary root.
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Paths } from '../../lib/paths';
import { ARANEUM_SOURCE, LEMMA_POS_FILE, SUBTITLE_FILE, SUBTITLE_SOURCE, WORD_TAG_FILE } from '.';

export const FREQ_FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** Places the sample where freq and dict read: content/raw and content/build/morph. */
export async function seedFreqSample(paths: Paths): Promise<void> {
  const copy = async (from: string, to: string) => {
    await mkdir(join(to, '..'), { recursive: true });
    await copyFile(join(FREQ_FIXTURES, from), to);
  };
  await copy('lemmas.jsonl', join(paths.build, 'morph', 'lemmas.jsonl'));
  await copy('forms.jsonl', join(paths.build, 'morph', 'forms.jsonl'));
  await copy('lemma-pos.tsv.xz', join(paths.raw, ARANEUM_SOURCE, LEMMA_POS_FILE));
  await copy('word-tag.tsv.xz', join(paths.raw, ARANEUM_SOURCE, WORD_TAG_FILE));
  await copy('sk_full.txt', join(paths.raw, SUBTITLE_SOURCE, SUBTITLE_FILE));
  await copy(
    'kaikki-sample.jsonl',
    join(paths.raw, 'kaikki-wiktionary', 'kaikki.org-dictionary-Slovak.jsonl'),
  );
}
