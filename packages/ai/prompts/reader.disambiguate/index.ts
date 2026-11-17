// Prompt folder of the route `reader.disambiguate`. Owner: B3. Add a version as v<N>.ts and point
// `current` at it; keep old versions for the evals.
import type { RecordedCall, ScriptedAnswer } from '../../src/mock';
import type { PromptFolder } from '../../src/prompt';
import { v1 } from './v1';

/**
 * Local mode: picks the first reading of every word (the analyzer lists the most frequent
 * first). An unreadable message gets an empty answer, so every word falls back to a guess.
 */
export function firstReadingMock(call: RecordedCall): ScriptedAnswer {
  const last = call.messages[call.messages.length - 1]?.content ?? '';
  try {
    const parsed = JSON.parse(last) as { words?: { w?: unknown }[] };
    const picks = (parsed.words ?? [])
      .map((x) => x.w)
      .filter((w): w is number => typeof w === 'number')
      .map((w) => ({ w, c: 0 }));
    return { data: { picks } };
  } catch {
    return { data: { picks: [] } };
  }
}

export const prompt: PromptFolder = {
  route: 'reader.disambiguate',
  current: 1,
  versions: { 1: v1 },
  mock: firstReadingMock,
};
