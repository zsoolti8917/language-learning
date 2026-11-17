// Prompt folder of the route `tutor.summary`. Owner: B9. Add a version as v<N>.ts and point
// `current` at it; keep old versions for the evals.
import type { PromptFolder } from '../../src/prompt';
import { v1 } from './v1';

export const prompt: PromptFolder = {
  route: 'tutor.summary',
  current: 1,
  versions: { 1: v1 },
};
