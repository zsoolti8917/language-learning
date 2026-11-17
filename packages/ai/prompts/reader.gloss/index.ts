// Prompt folder of the route `reader.gloss`. Owner: B2. Add a version as v<N>.ts and point
// `current` at it; keep old versions for the evals.
import type { PromptFolder } from '../../src/prompt';
import { v1 } from './v1';

export const prompt: PromptFolder = {
  route: 'reader.gloss',
  current: 1,
  versions: { 1: v1 },
};
