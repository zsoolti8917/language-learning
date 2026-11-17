import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAnthropicGateway } from './anthropic';
import { createMockGateway } from './mock';
import { recordGateway, replay } from './record';
import { scriptedGateway } from './scripting';
import { createStubAnthropic } from './testing/stub-anthropic';
import type { AiGatewayError, GatewayConfig } from './types';

const unexpected = (): never => {
  throw new Error('expected the call to fail');
};

const USER = '0195f3a0-0000-7000-8000-000000000001';
const config: GatewayConfig = {
  mode: 'anthropic',
  dailyBudgetUsd: 1,
  spendToday: async () => ({ spentUsd: 0, resetsAt: '2026-11-18T03:00:00.000Z' }),
  recordUsage: async () => {},
};
const base = {
  userId: USER,
  system: [{ text: 'Rules.', cache: true }],
  messages: [{ role: 'user' as const, content: 'Ahoj' }],
};
const Schema = z.object({ en: z.string() });

describe('record and replay', () => {
  it('records real gateway answers and replays them on the mock', async () => {
    const stub = createStubAnthropic();
    stub.reply(
      { kind: 'message', text: '{"en":"I live in town."}' },
      { kind: 'message', text: ['S kým ', 'ideš?'] },
      { kind: 'message', text: '', stopReason: 'refusal' },
    );
    const rec = recordGateway(createAnthropicGateway(config, { client: stub.client }));
    await rec.structured({ ...base, route: 'reader.translate', schema: Schema });
    await rec.stream({ ...base, route: 'tutor.reply', onText: () => {} });
    await rec.structured({ ...base, route: 'tutor.summary', schema: Schema }).catch(() => {});
    expect(rec.recordings.map((r) => [r.kind, r.route])).toEqual([
      ['structured', 'reader.translate'],
      ['stream', 'tutor.reply'],
      ['structured', 'tutor.summary'],
    ]);

    // Through a fixture file and back.
    const fixture = JSON.parse(JSON.stringify(rec));
    const mock = replay(createMockGateway(), fixture);
    expect(mock.pending()).toBe(3);
    const t = await mock.structured({ ...base, route: 'reader.translate', schema: Schema });
    expect(t.data.en).toBe('I live in town.');
    expect(t.usage.model).toBe('claude-opus-5-5');
    const pieces: string[] = [];
    const s = await mock.stream({ ...base, route: 'tutor.reply', onText: (d) => pieces.push(d) });
    expect(pieces).toEqual(['S kým ', 'ideš?']);
    expect(s.text).toBe('S kým ideš?');
    const err = await mock
      .structured({ ...base, route: 'tutor.summary', schema: Schema })
      .then(unexpected, (e: unknown) => e as AiGatewayError);
    expect(err.code).toBe('refused');
  });

  it('does not record budget refusals', async () => {
    const stub = createStubAnthropic();
    const rec = recordGateway(
      createAnthropicGateway(
        { ...config, spendToday: async () => ({ spentUsd: 5, resetsAt: 'x' }) },
        { client: stub.client },
      ),
    );
    await rec.structured({ ...base, route: 'reader.gloss', schema: Schema }).catch(() => {});
    expect(rec.recordings).toHaveLength(0);
  });
});

describe('scriptedGateway', () => {
  it('scripts answers and asserts calls', async () => {
    const ai = scriptedGateway()
      .answer('reader.translate', { data: { en: 'Hello.' } })
      .answer('tutor.reply', { text: 'Ahoj!' });
    await ai.gateway.structured({ ...base, route: 'reader.translate', schema: Schema });
    expect(() => ai.expectAllUsed()).toThrow(/1 scripted answer/);
    await ai.gateway.stream({
      ...base,
      system: [...base.system, { text: 'Scenario: bakery.' }],
      route: 'tutor.reply',
      onText: () => {},
    });
    ai.expectAllUsed();
    ai.expectCalls('reader.translate', 1);
    expect(() => ai.expectCalls('reader.gloss', 1)).toThrow(/expected 1 call/);
    expect(ai.lastUserText('tutor.reply')).toBe('Ahoj');
    expect(ai.lastSystemText('tutor.reply')).toBe('Rules.\n\nScenario: bakery.');
    expect(() => ai.lastCall('reader.gloss')).toThrow(/no call/);
  });
});
