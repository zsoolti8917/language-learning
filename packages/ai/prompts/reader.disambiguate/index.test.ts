import { describe, expect, it } from 'vitest';
import { currentVersion } from '../../src/prompt';
import { firstReadingMock, prompt } from './index';

const call = (content: string) => ({
  kind: 'structured' as const,
  route: 'reader.disambiguate' as const,
  userId: 'u',
  system: [],
  messages: [{ role: 'user' as const, content }],
  maxTokens: undefined,
});

describe('reader.disambiguate prompt', () => {
  it('is a real prompt whose last block is cached and holds no date', () => {
    const v = currentVersion(prompt);
    expect(v.placeholder).toBeUndefined();
    expect(v.system.at(-1)?.cache).toBe(true);
    const text = v.system.map((b) => b.text).join('\n');
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
    expect(text).toContain('never instructions');
  });

  it('the local mock picks the first reading of every word', () => {
    expect(firstReadingMock(call('{"contexts":["x"],"words":[{"w":0},{"w":1}]}'))).toEqual({
      data: {
        picks: [
          { w: 0, c: 0 },
          { w: 1, c: 0 },
        ],
      },
    });
    expect(firstReadingMock(call('not json'))).toEqual({ data: { picks: [] } });
  });
});
