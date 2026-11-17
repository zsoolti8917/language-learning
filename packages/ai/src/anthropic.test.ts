import { AI_ROUTES, type AiRoute } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildRequest, createAnthropicGateway } from './anthropic';
import { createGateway } from './factory';
import type { ScriptedAnswer } from './mock';
import { costOf } from './pricing';
import { ROUTE_DEFAULTS, routeOverridesFromEnv, routeSettings } from './routes';
import { runGatewaySuite } from './testing/gateway-suite';
import { createStubAnthropic, type StubReply } from './testing/stub-anthropic';
import { AiGatewayError, DEFAULT_MODEL, type GatewayConfig, type UsageRow } from './types';

const unexpected = (): never => {
  throw new Error('expected the call to fail');
};

/** A scripted answer as the stub's reply: data → JSON text, text → pieces, error → its cause. */
function toReply(answer: ScriptedAnswer): StubReply {
  const usage = answer.usage
    ? {
        input_tokens: answer.usage.inputTokens ?? 0,
        output_tokens: answer.usage.outputTokens ?? 0,
        cache_read_input_tokens: answer.usage.cacheReadTokens ?? 0,
        cache_creation_input_tokens: answer.usage.cacheWriteTokens ?? 0,
      }
    : undefined;
  // The suite gives a cost; the stub gives tokens. 1 output token of Opus 5.5 costs $0.00002.
  if (usage && answer.usage?.costUsd !== undefined && !answer.usage.outputTokens) {
    usage.input_tokens = 0;
    usage.output_tokens = Math.round(answer.usage.costUsd / 0.00002);
  }
  if ('error' in answer) {
    if (answer.error === 'refused') return { kind: 'message', text: '', stopReason: 'refusal' };
    if (answer.error === 'truncated')
      return { kind: 'message', text: '{"index":', stopReason: 'max_tokens' };
    return { kind: 'http_error', status: 500 };
  }
  if ('data' in answer) return { kind: 'message', text: JSON.stringify(answer.data), usage };
  return { kind: 'message', text: answer.text, usage };
}

runGatewaySuite('anthropic (stubbed SDK client)', (config) => {
  const stub = createStubAnthropic();
  const gateway = createAnthropicGateway({ ...config, mode: 'anthropic' }, { client: stub.client });
  return {
    gateway,
    script: (_route, answer) => stub.reply(toReply(answer)),
    modelCalls: () => stub.requests.length,
  };
});

const USER = '0195f3a0-0000-7000-8000-000000000001';

function harness(
  opts: { budget?: number; models?: GatewayConfig['models']; maxRetries?: number } = {},
) {
  const rows: UsageRow[] = [];
  const stub = createStubAnthropic({ maxRetries: opts.maxRetries ?? 0 });
  let clock = 1000;
  const config: GatewayConfig = {
    mode: 'anthropic',
    dailyBudgetUsd: opts.budget ?? 1,
    models: opts.models,
    spendToday: async (userId) => ({
      spentUsd: rows.filter((r) => r.userId === userId).reduce((n, r) => n + r.costUsd, 0),
      resetsAt: '2026-11-18T03:00:00.000Z',
    }),
    recordUsage: async (row) => {
      rows.push(row);
    },
  };
  const gateway = createAnthropicGateway(config, {
    client: stub.client,
    // Every reading of the clock moves it 250 ms: a call measures 250 ms.
    now: () => {
      clock += 250;
      return clock;
    },
  });
  return { stub, gateway, rows };
}

const system = [
  { text: 'Role and rules.' },
  { text: 'Error checklist.', cache: true },
  { text: 'Scenario: at the cinema.' },
];
const messages = [{ role: 'user' as const, content: 'Idem s kamarát do kina.' }];
const Schema = z.object({ errors: z.array(z.object({ form: z.string() })) });

describe('request per route', () => {
  for (const route of AI_ROUTES) {
    it(`${route}: model, effort, token limit, timeout, cache mark`, async () => {
      const h = harness();
      const streamed = route === 'tutor.reply';
      h.stub.reply({ kind: 'message', text: streamed ? 'Ahoj!' : '{"errors":[]}' });
      if (streamed)
        await h.gateway.stream({ route, userId: USER, system, messages, onText: () => {} });
      else await h.gateway.structured({ route, userId: USER, system, messages, schema: Schema });
      const req = h.stub.requests[0];
      expect(req?.url).toMatch(/\/v1\/messages$/);
      const body = req?.body;
      expect(body?.model).toBe(DEFAULT_MODEL);
      expect(body?.max_tokens).toBe(ROUTE_DEFAULTS[route].maxTokens);
      expect(body?.output_config?.effort).toBe(ROUTE_DEFAULTS[route].effort);
      expect(body?.stream === true).toBe(streamed);
      // The marker sits on the last stable block; the scenario after it is not cached.
      expect(body?.system).toEqual([
        { type: 'text', text: 'Role and rules.' },
        { type: 'text', text: 'Error checklist.', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Scenario: at the cinema.' },
      ]);
      expect(body?.messages).toEqual(messages);
      // No prefill, no sampling parameters, no thinking setting (adaptive by default).
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('thinking');
      // The SDK sends the route's timeout as the request timeout header.
      expect(req?.headers['x-stainless-timeout']).toBe(
        String(ROUTE_DEFAULTS[route].timeoutMs / 1000),
      );
    });
  }

  it('structured calls send the JSON schema of the zod schema; streams send none', async () => {
    const h = harness();
    h.stub.reply({ kind: 'message', text: '{"errors":[{"form":"kamarát"}]}', thinking: true });
    const res = await h.gateway.structured({
      route: 'tutor.analyze',
      userId: USER,
      system,
      messages,
      schema: Schema,
    });
    expect(res.data).toEqual({ errors: [{ form: 'kamarát' }] });
    const format = h.stub.requests[0]?.body.output_config?.format;
    expect(format?.type).toBe('json_schema');
    expect(format?.schema).toMatchObject({
      type: 'object',
      properties: { errors: { type: 'array' } },
      required: ['errors'],
      additionalProperties: false,
    });
    h.stub.reply({ kind: 'message', text: 'Ahoj' });
    await h.gateway.stream({
      route: 'tutor.reply',
      userId: USER,
      system,
      messages,
      onText: () => {},
    });
    expect(h.stub.requests[1]?.body.output_config).toEqual({ effort: 'low' });
  });

  it('uses the model of the config, the overrides, and the request token limit', async () => {
    const h = harness({ models: { 'reader.gloss': 'claude-sonnet-5-5' } });
    h.stub.reply({ kind: 'message', text: '{"errors":[]}' });
    await h.gateway.structured({
      route: 'reader.gloss',
      userId: USER,
      system,
      messages,
      schema: Schema,
      maxTokens: 123,
    });
    expect(h.stub.requests[0]?.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 123 });
    const s = routeSettings('tutor.reply', undefined, {
      'tutor.reply': { effort: 'high', timeoutMs: 5000 },
    });
    expect(s).toEqual({ model: DEFAULT_MODEL, effort: 'high', maxTokens: 4000, timeoutMs: 5000 });
    expect(buildRequest(s, { system, messages }).output_config).toEqual({ effort: 'high' });
  });

  it('a system prompt without a cache mark sends no cache_control', () => {
    const body = buildRequest(routeSettings('reader.translate'), {
      system: [{ text: 'a' }, { text: 'b' }],
      messages,
    });
    expect(JSON.stringify(body.system)).not.toContain('cache_control');
  });
});

describe('route overrides from the environment', () => {
  it('reads effort, token limit and timeout per route', () => {
    expect(
      routeOverridesFromEnv({
        AI_EFFORT_TUTOR_REPLY: 'medium',
        AI_MAX_TOKENS_READER_GLOSS: '2048',
        AI_TIMEOUT_MS_TUTOR_ANALYZE: '15000',
        AI_EFFORT_TUTOR_SUMMARY: '',
      }),
    ).toEqual({
      'tutor.reply': { effort: 'medium' },
      'reader.gloss': { maxTokens: 2048 },
      'tutor.analyze': { timeoutMs: 15000 },
    });
  });

  it('rejects invalid values', () => {
    expect(() => routeOverridesFromEnv({ AI_EFFORT_TUTOR_REPLY: 'huge' })).toThrow(/AI_EFFORT/);
    expect(() => routeOverridesFromEnv({ AI_MAX_TOKENS_TUTOR_REPLY: '-1' })).toThrow(/AI_MAX/);
  });

  it('createGateway applies them in anthropic mode', async () => {
    const stub = createStubAnthropic();
    const gw = createGateway(
      {
        mode: 'anthropic',
        dailyBudgetUsd: 1,
        spendToday: async () => ({ spentUsd: 0, resetsAt: '2026-11-18T03:00:00.000Z' }),
        recordUsage: async () => {},
      },
      { client: stub.client, routes: routeOverridesFromEnv({ AI_EFFORT_TUTOR_REPLY: 'high' }) },
    );
    stub.reply({ kind: 'message', text: 'Ahoj' });
    await gw.stream({ route: 'tutor.reply', userId: USER, system, messages, onText: () => {} });
    expect(stub.requests[0]?.body.output_config?.effort).toBe('high');
  });

  it('createGateway needs a key in anthropic mode and builds no client in mock mode', () => {
    const base = {
      dailyBudgetUsd: 1,
      spendToday: async () => ({ spentUsd: 0, resetsAt: '' }),
      recordUsage: async () => {},
    };
    expect(() => createGateway({ ...base, mode: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => createGateway({ ...base, mode: 'anthropic', apiKey: 'k' })).not.toThrow();
    expect('script' in createGateway({ ...base, mode: 'mock' })).toBe(true);
  });
});

describe('stop reasons and SDK errors', () => {
  async function structuredError(h: ReturnType<typeof harness>, route: AiRoute = 'tutor.analyze') {
    return h.gateway
      .structured({ route, userId: USER, system, messages, schema: Schema })
      .then(unexpected, (e: unknown) => e as AiGatewayError);
  }

  it('refusal → refused with the category, usage row refused', async () => {
    const h = harness();
    h.stub.reply({ kind: 'message', text: '', stopReason: 'refusal', refusalCategory: 'cyber' });
    const err = await structuredError(h);
    expect(err).toBeInstanceOf(AiGatewayError);
    expect(err.code).toBe('refused');
    expect(err.details).toMatchObject({ category: 'cyber', stopReason: 'refusal' });
    expect(h.rows[0]?.status).toBe('refused');
  });

  for (const stop of ['max_tokens', 'model_context_window_exceeded'] as const) {
    it(`${stop} → truncated, usage row truncated, no partial data`, async () => {
      const h = harness();
      h.stub.reply({ kind: 'message', text: '{"errors":[', stopReason: stop });
      const err = await structuredError(h);
      expect(err.code).toBe('truncated');
      expect(h.rows[0]?.status).toBe('truncated');
    });
  }

  for (const stop of ['tool_use', 'pause_turn'] as const) {
    it(`${stop} → upstream_failed (unexpected_stop)`, async () => {
      const h = harness();
      h.stub.reply({ kind: 'message', text: '{"errors":[]}', stopReason: stop });
      const err = await structuredError(h);
      expect(err.code).toBe('upstream_failed');
      expect(err.details.reason).toBe('unexpected_stop');
      expect(h.rows[0]?.status).toBe('error');
    });
  }

  it('text that is not JSON → upstream_failed invalid_output', async () => {
    const h = harness();
    h.stub.reply({ kind: 'message', text: 'Sorry, here is the answer: …' });
    const err = await structuredError(h);
    expect(err.code).toBe('upstream_failed');
    expect(err.details.reason).toBe('invalid_output');
    expect(h.rows[0]).toMatchObject({ status: 'error', requestId: expect.stringMatching(/^req_/) });
  });

  const httpCases = [
    [400, 'bad_request'],
    [401, 'auth'],
    [429, 'rate_limited'],
    [500, 'provider_error'],
    [529, 'overloaded'],
  ] as const;
  for (const [status, reason] of httpCases) {
    it(`HTTP ${status} → upstream_failed (${reason}) with the request id`, async () => {
      const h = harness();
      h.stub.reply({ kind: 'http_error', status });
      const err = await structuredError(h);
      expect(err.code).toBe('upstream_failed');
      expect(err.details).toMatchObject({
        status,
        reason,
        requestId: expect.stringMatching(/^req_/),
      });
      expect(err.message).not.toContain('stubbed error');
      expect(h.rows[0]).toMatchObject({ status: 'error', costUsd: 0, inputTokens: 0 });
      expect(h.rows[0]?.requestId).toMatch(/^req_/);
    });
  }

  it('a network failure → upstream_failed (connection)', async () => {
    const h = harness();
    h.stub.reply({ kind: 'network_error' });
    const err = await structuredError(h);
    expect(err.code).toBe('upstream_failed');
    expect(err.details.reason).toBe('connection');
  });

  it('short outages are retried by the SDK before the gateway answers', async () => {
    const h = harness({ maxRetries: 2 });
    h.stub.reply({ kind: 'http_error', status: 529 }, { kind: 'http_error', status: 500 });
    h.stub.reply({ kind: 'message', text: '{"errors":[]}' });
    const res = await h.gateway.structured({
      route: 'tutor.analyze',
      userId: USER,
      system,
      messages,
      schema: Schema,
    });
    expect(res.data.errors).toEqual([]);
    expect(h.stub.requests).toHaveLength(3);
    expect(h.rows).toHaveLength(1);
  });

  it('a stream that ends in a refusal or cut off rejects after its pieces', async () => {
    for (const [stopReason, code] of [
      ['refusal', 'refused'],
      ['max_tokens', 'truncated'],
    ] as const) {
      const h = harness();
      h.stub.reply({ kind: 'message', text: ['Ahoj ', 'ako'], stopReason });
      const pieces: string[] = [];
      const err = await h.gateway
        .stream({
          route: 'tutor.reply',
          userId: USER,
          system,
          messages,
          onText: (d) => pieces.push(d),
        })
        .then(unexpected, (e: unknown) => e as AiGatewayError);
      expect(err.code).toBe(code);
      expect(h.rows[0]?.status).toBe(code);
    }
  });

  it('a stream HTTP error → upstream_failed', async () => {
    const h = harness();
    h.stub.reply({ kind: 'http_error', status: 500 });
    const err = await h.gateway
      .stream({ route: 'tutor.reply', userId: USER, system, messages, onText: () => {} })
      .then(unexpected, (e: unknown) => e as AiGatewayError);
    expect(err.code).toBe('upstream_failed');
    expect(h.rows[0]?.status).toBe('error');
  });

  it('an aborted structured call rejects with AbortError and records the row', async () => {
    const h = harness();
    h.stub.reply({ kind: 'message', text: '{"errors":[]}' });
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await h.gateway
      .structured({
        route: 'tutor.analyze',
        userId: USER,
        system,
        messages,
        schema: Schema,
        signal: ctrl.signal,
      })
      .then(unexpected, (e: unknown) => e as Error);
    expect(err.name).toBe('AbortError');
    expect(h.stub.requests).toHaveLength(0);
  });

  it('an aborted stream records the tokens seen so far', async () => {
    const h = harness();
    h.stub.reply({
      kind: 'message',
      text: ['a ', 'b ', 'c ', 'd'],
      usage: { input_tokens: 1000, output_tokens: 50 },
    });
    const ctrl = new AbortController();
    const err = await h.gateway
      .stream({
        route: 'tutor.reply',
        userId: USER,
        system,
        messages,
        signal: ctrl.signal,
        onText: () => ctrl.abort(),
      })
      .then(unexpected, (e: unknown) => e as Error);
    expect(err.name).toBe('AbortError');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ status: 'error', inputTokens: 1000 });
    expect(h.rows[0]?.costUsd).toBeGreaterThan(0);
  });

  it('a consumer that throws ends the stream with its own error', async () => {
    const h = harness();
    h.stub.reply({ kind: 'message', text: ['a ', 'b ', 'c'] });
    const boom = new Error('client gone');
    const err = await h.gateway
      .stream({
        route: 'tutor.reply',
        userId: USER,
        system,
        messages,
        onText: () => {
          throw boom;
        },
      })
      .catch((e: unknown) => e);
    expect(err).toBe(boom);
    expect(h.rows[0]?.status).toBe('error');
  });
});

describe('usage rows and cost', () => {
  it('the cost in a row equals a hand calculation from the token counts', async () => {
    const h = harness();
    h.stub.reply({
      kind: 'message',
      text: '{"errors":[]}',
      usage: {
        input_tokens: 1200,
        output_tokens: 350,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 2500,
      },
    });
    const res = await h.gateway.structured({
      route: 'tutor.analyze',
      userId: USER,
      system,
      messages,
      schema: Schema,
    });
    // Claude Opus 5.5 per million tokens: input $4, output $20, cache read $0.20, 5 min write $5.
    // 1200 × 4 + 350 × 20 + 4000 × 0.2 + 2500 × 5 = 4800 + 7000 + 800 + 12500 = 25100 µ$
    const hand = 0.0251;
    expect(res.usage.costUsd).toBe(hand);
    expect(h.rows).toEqual([
      {
        userId: USER,
        route: 'tutor.analyze',
        model: DEFAULT_MODEL,
        inputTokens: 1200,
        outputTokens: 350,
        cacheReadTokens: 4000,
        cacheWriteTokens: 2500,
        costUsd: hand,
        latencyMs: 250,
        status: 'ok',
        requestId: expect.stringMatching(/^req_stub_/),
      },
    ]);
  });

  it('a streamed call records the usage of the final message', async () => {
    const h = harness();
    h.stub.reply({
      kind: 'message',
      text: ['S kým ', 'ideš?'],
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 3000 },
    });
    const res = await h.gateway.stream({
      route: 'tutor.reply',
      userId: USER,
      system,
      messages,
      onText: () => {},
    });
    // 100 × 4 + 10 × 20 + 3000 × 0.2 = 400 + 200 + 600 = 1200 µ$
    expect(res.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 3000,
      costUsd: 0.0012,
    });
    expect(h.rows[0]).toMatchObject({ status: 'ok', costUsd: 0.0012, latencyMs: 250 });
  });

  it('one hour cache writes cost twice the input price', () => {
    expect(
      costOf(DEFAULT_MODEL, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000_000,
        cacheWrite1hTokens: 400_000,
      }),
    ).toBe(600_000 * 5e-6 + 400_000 * 8e-6);
  });

  it('a model missing from the table is priced at the dearest row', () => {
    const t = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costOf('claude-unknown', t)).toBe(costOf('claude-opus-5', t));
    expect(costOf('claude-unknown', t)).toBeGreaterThan(costOf(DEFAULT_MODEL, t));
  });
});

describe('daily budget', () => {
  it('stops at the budget and resumes on the next learner day', async () => {
    // A learner in New York whose day starts at 03:00 local time (08:00 UTC in November).
    let now = new Date('2026-11-17T20:00:00Z');
    const rows: (UsageRow & { at: Date })[] = [];
    const dayStart = (d: Date) => {
      const s = new Date(d);
      s.setUTCHours(8, 0, 0, 0);
      if (s > d) s.setUTCDate(s.getUTCDate() - 1);
      return s;
    };
    const stub = createStubAnthropic();
    const gw = createAnthropicGateway(
      {
        mode: 'anthropic',
        dailyBudgetUsd: 0.05,
        spendToday: async (userId) => {
          const start = dayStart(now);
          const end = new Date(start.getTime() + 86_400_000);
          return {
            spentUsd: rows
              .filter((r) => r.userId === userId && r.at >= start && r.at < end)
              .reduce((n, r) => n + r.costUsd, 0),
            resetsAt: end.toISOString(),
          };
        },
        recordUsage: async (row) => {
          rows.push({ ...row, at: now });
        },
      },
      { client: stub.client },
    );
    const call = () =>
      gw.structured({ route: 'reader.translate', userId: USER, system, messages, schema: Schema });
    // 2500 output tokens × $20 / M = $0.05: the first call uses the whole budget.
    stub.reply({
      kind: 'message',
      text: '{"errors":[]}',
      usage: { input_tokens: 0, output_tokens: 2500 },
    });
    await call();
    const err = await call().then(unexpected, (e: unknown) => e as AiGatewayError);
    expect(err.code).toBe('budget_exceeded');
    expect(err.details.resetsAt).toBe('2026-11-18T08:00:00.000Z');
    expect(stub.requests).toHaveLength(1);
    // Still the same learner day at 07:59 UTC the next morning.
    now = new Date('2026-11-18T07:59:00Z');
    expect((await call().then(unexpected, (e: unknown) => e as AiGatewayError)).code).toBe(
      'budget_exceeded',
    );
    // The next learner day.
    now = new Date('2026-11-18T08:00:00Z');
    stub.reply({ kind: 'message', text: '{"errors":[]}' });
    await expect(call()).resolves.toMatchObject({ data: { errors: [] } });
    expect(stub.requests).toHaveLength(2);
  });
});
