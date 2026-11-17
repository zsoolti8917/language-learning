// Prompt folder of the route `reader.translate`. Owner: B4. Add a version as v<N>.ts and point
// `current` at it; keep old versions for the evals. The answer's schema is
// `TranslationSchema` in apps/api/src/modules/reader/service.ts: `{ en: string }`.
import type { PromptFolder } from '../../src/prompt';
import { v1 } from './v1';

/** The sentence of a request, for the local mode answer. */
function sentenceOf(content: string): string {
  return /<sentence>([\s\S]*)<\/sentence>/.exec(content)?.[1]?.trim() ?? content.trim();
}

export const prompt: PromptFolder = {
  route: 'reader.translate',
  current: 1,
  versions: { 1: v1 },
  // Local mode has no model: it answers with the sentence marked as untranslated.
  mock: (call) => {
    const last = call.messages.at(-1)?.content ?? '';
    return { data: { en: `[EN] ${sentenceOf(last)}` } };
  },
};
