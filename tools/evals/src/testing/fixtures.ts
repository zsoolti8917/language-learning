// Shared test inputs: the mini dataset as the morphology, and a hand written treebank excerpt
// whose words the mini dataset knows.
import { readFileSync } from 'node:fs';
import { MINI_DIR } from '@app/testkit/mini';
import { Lexicon, sourceFromContentDir } from '../lexicon';
import { parseConllu, type UdSentence } from '../ud/conllu';

export const FIXTURE_CONLLU = new URL('../fixtures/mini.conllu', import.meta.url);

let lexicon: Lexicon | undefined;

/** The mini dataset in memory, with its triggers and the preposition triggers of its data. */
export function miniLexicon(): Lexicon {
  lexicon ??= new Lexicon(sourceFromContentDir(MINI_DIR));
  return lexicon;
}

export function fixtureSentences(): UdSentence[] {
  return parseConllu(readFileSync(FIXTURE_CONLLU, 'utf8'), 'fixture');
}
