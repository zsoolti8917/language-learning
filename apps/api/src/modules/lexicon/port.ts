// MorphologyPort and DictionaryPort of the lexicon module. Owner: B2, who replaces the
// bodies of these two factories with the real ports. container.ts calls them.
import type { DictionaryPort, MorphologyPort, PortContext } from '../../ports';
import { createMiniDictionary, createMiniMorphology } from '../../testing/lexicon';

export function createMorphologyPort(_ctx: PortContext): MorphologyPort {
  return createMiniMorphology();
}

export function createDictionaryPort(_ctx: PortContext): DictionaryPort {
  return createMiniDictionary();
}
