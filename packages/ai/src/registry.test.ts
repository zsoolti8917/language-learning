import { AI_ROUTES } from '@app/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PROMPTS } from '../prompts';
import type { PromptFolder } from './prompt';
import { promptFor, promptVersions, systemFor, volatileValues } from './registry';

describe('prompt registry', () => {
  it('gives every live route its version in use, ending with the cache mark', () => {
    for (const route of AI_ROUTES) {
      const p = promptFor(route);
      expect(p.route).toBe(route);
      expect(p.version).toBe(PROMPTS[route].current);
      expect(p.system.length).toBeGreaterThan(0);
      expect(p.system.at(-1)?.cache).toBe(true);
      expect(p.system.filter((b) => b.cache)).toHaveLength(1);
    }
    expect(Object.keys(promptVersions()).sort()).toEqual([...AI_ROUTES].sort());
  });

  it('puts per request text after the cache mark', () => {
    const blocks = systemFor('tutor.reply', ['Scenario: at the bakery.']);
    expect(blocks.at(-1)).toEqual({ text: 'Scenario: at the bakery.' });
    expect(blocks.at(-2)?.cache).toBe(true);
  });

  it('marks the last block when a version marks none, and only the last marked one', () => {
    const folder = (system: PromptFolder['versions'][number]['system']): PromptFolder => ({
      route: 'reader.gloss',
      current: 2,
      versions: { 2: { version: 2, system } },
    });
    const folders = { ...PROMPTS };
    folders['reader.gloss'] = folder([{ text: 'a' }, { text: 'b' }]);
    expect(promptFor('reader.gloss', folders).system).toEqual([
      { text: 'a' },
      { text: 'b', cache: true },
    ]);
    folders['reader.gloss'] = folder([
      { text: 'a', cache: true },
      { text: 'b', cache: true },
      { text: 'c' },
    ]);
    expect(promptFor('reader.gloss', folders).system).toEqual([
      { text: 'a' },
      { text: 'b', cache: true },
      { text: 'c' },
    ]);
    folders['reader.gloss'] = { ...folder([]), current: 9 };
    expect(() => promptFor('reader.gloss', folders)).toThrow(/no version 9/);
  });
});

describe('prompts hold no values that change per request', () => {
  it('no version of any prompt folder contains a date, time, id or random number', () => {
    for (const folder of Object.values(PROMPTS))
      for (const v of Object.values(folder.versions))
        for (const b of v.system)
          expect(volatileValues(b.text), `${folder.route} v${v.version}`).toEqual([]);
  });

  it('every prompt is the same text when its module is loaded again', async () => {
    const first = JSON.stringify((await import('../prompts')).PROMPTS);
    vi.resetModules();
    const second = JSON.stringify((await import('../prompts')).PROMPTS);
    expect(second).toBe(first);
  });

  it('the check finds dates, times, ids and random numbers', () => {
    expect(volatileValues('Today is 2026-11-17.')).toHaveLength(1);
    expect(volatileValues('Dnes je 17. 11. 2026.')).toHaveLength(1);
    expect(volatileValues('Today is November 17, 2026.')).toHaveLength(1);
    expect(volatileValues('Dnes je 17. novembra 2026.')).toHaveLength(1);
    expect(volatileValues('It is 08:30 now.')).toHaveLength(1);
    expect(volatileValues('id 0195f3a0-0000-7000-8000-000000000001').join()).toContain('uuid');
    expect(volatileValues(`seed ${Math.random()}`).length).toBeGreaterThan(0);
    expect(volatileValues(`now ${Date.now()}`)).toHaveLength(1);
    expect(volatileValues('Ask at most 2 questions in 7 cases, 1 per message.')).toEqual([]);
  });
});
