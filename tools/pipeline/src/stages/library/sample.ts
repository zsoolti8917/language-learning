// Test seed for the library and scenarios stages: the real authored texts and scenarios, and
// the morphology and ranks cut down to the words they use (fixtures/make-fixture.py), placed
// in a temporary root where the stages read them.
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, type Paths } from '../../lib/paths';

export const LIBRARY_FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** content/authored/{library,scenarios} of the repository, the cut morphology and ranks, and the mini triggers. */
export async function seedLibrarySample(paths: Paths): Promise<void> {
  const repo = join(findRoot(), 'content', 'authored');
  for (const d of ['library', 'scenarios'])
    await cp(join(repo, d), join(paths.content, 'authored', d), { recursive: true });
  const copy = async (from: string, to: string) => {
    await mkdir(join(to, '..'), { recursive: true });
    await copyFile(join(LIBRARY_FIXTURES, from), to);
  };
  await copy('lemmas.jsonl', join(paths.build, 'morph', 'lemmas.jsonl'));
  await copy('forms.jsonl', join(paths.build, 'morph', 'forms.jsonl'));
  await copy('ranks.jsonl', join(paths.build, 'freq', 'lemmas.jsonl'));
  // The mini dataset's triggers, which scenarios may name.
  await mkdir(paths.mini, { recursive: true });
  await copyFile(
    join(findRoot(), 'packages', 'testkit', 'mini', 'triggers.jsonl'),
    join(paths.mini, 'triggers.jsonl'),
  );
}
