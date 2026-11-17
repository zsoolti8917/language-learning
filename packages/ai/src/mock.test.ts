import { AI_ROUTES } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PROMPTS } from '../prompts';
import { createGateway } from './factory';
import { createMockGateway } from './mock';
import { currentVersion } from './prompt';
import { runGatewaySuite } from './testing/gateway-suite';
import { AiGatewayError, DEFAULT_MODEL } from './types';

runGatewaySuite('mock', (config) => {
  const gateway = createMockGateway(config);
  return {
    gateway,
    script: (route, answer) => gateway.script(route, answer),
    modelCalls: () => gateway.calls.length,
  };
});

const req = {
  userId: '0195f3a0-0000-7000-8000-000000000001',
  system: [{ text: 'x', cache: true }],
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('mock gateway', () => {
  it('logs calls, takes queued answers in order, then the responder', async () => {
    const gw = createMockGateway();
    gw.script('reader.gloss', { data: { n: 1 } }, { data: { n: 2 } });
    gw.respond('reader.gloss', (call) => ({ data: { n: call.messages.length * 10 } }));
    const schema = z.object({ n: z.int() });
    const got = [];
    for (let i = 0; i < 3; i++)
      got.push((await gw.structured({ ...req, route: 'reader.gloss', schema })).data.n);
    expect(got).toEqual([1, 2, 10]);
    expect(gw.calls).toHaveLength(3);
    expect(gw.callsFor('reader.gloss')[0]).toMatchObject({
      kind: 'structured',
      userId: req.userId,
    });
    expect(gw.pending()).toBe(0);
    gw.reset();
    expect(gw.calls).toHaveLength(0);
  });

  it('fails with upstream_failed when nothing is scripted', async () => {
    const gw = createMockGateway();
    await expect(
      gw.stream({ ...req, route: 'tutor.reply', onText: () => {} }),
    ).rejects.toBeInstanceOf(AiGatewayError);
  });

  it('accepts JSON text for structured calls and uses the default model', async () => {
    const gw = createMockGateway().script('reader.translate', { text: '{"en":"Hi."}' });
    const res = await gw.structured({
      ...req,
      route: 'reader.translate',
      schema: z.object({ en: z.string() }),
    });
    expect(res.data.en).toBe('Hi.');
    expect(res.usage.model).toBe(DEFAULT_MODEL);
  });

  it('createGateway returns a mock with the local mode answers of the prompt folders', async () => {
    const gw = createGateway({
      mode: 'mock',
      dailyBudgetUsd: 1,
      models: { 'tutor.reply': 'claude-test' },
      spendToday: async () => ({ spentUsd: 0, resetsAt: new Date(0).toISOString() }),
      recordUsage: async () => {},
    });
    const res = await gw.stream({ ...req, route: 'tutor.reply', onText: () => {} });
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.usage.model).toBe('claude-test');
  });
});

describe('prompt folders', () => {
  it('has one folder per live route with a version in use', () => {
    expect(Object.keys(PROMPTS).sort()).toEqual([...AI_ROUTES].sort());
    for (const route of AI_ROUTES) {
      const folder = PROMPTS[route];
      expect(folder.route).toBe(route);
      const v = currentVersion(folder);
      expect(v.system.length).toBeGreaterThan(0);
      expect(v.system.some((b) => b.cache)).toBe(true);
    }
  });
});
