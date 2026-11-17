// The gateway's own test suite. The mock gateway passes it (gateway.test.ts), and B8's real
// gateway must pass it with a stubbed SDK client. Import it from a test file only.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ScriptedAnswer } from '../mock';
import {
  type AiGateway,
  AiGatewayError,
  type DailySpend,
  type GatewayConfig,
  type UsageRow,
} from '../types';

/** What the suite needs from an implementation. */
export interface GatewayHarness {
  gateway: AiGateway;
  /**
   * Makes the next model call of `route` answer with `answer`. The real gateway's harness
   * turns it into a stubbed SDK response (data → a JSON answer, text → a text stream, error →
   * a refusal, a cut off answer or an SDK error).
   */
  script(route: Parameters<AiGateway['stream']>[0]['route'], answer: ScriptedAnswer): void;
  /** How many model calls reached the provider (or the mock) so far. */
  modelCalls(): number;
}

/** `make` builds a fresh gateway with the config the suite gives. */
export function runGatewaySuite(
  name: string,
  make: (config: GatewayConfig) => GatewayHarness | Promise<GatewayHarness>,
): void {
  const USER = '0195f3a0-0000-7000-8000-000000000001';
  const RESETS = '2026-11-18T03:00:00.000Z';

  async function setup(budget = 1) {
    const rows: UsageRow[] = [];
    const config: GatewayConfig = {
      mode: 'mock',
      dailyBudgetUsd: budget,
      spendToday: async (userId): Promise<DailySpend> => ({
        spentUsd: rows.filter((r) => r.userId === userId).reduce((n, r) => n + r.costUsd, 0),
        resetsAt: RESETS,
      }),
      recordUsage: async (row) => {
        rows.push(row);
      },
    };
    const h = await make(config);
    return { ...h, rows };
  }

  const base = {
    userId: USER,
    system: [{ text: 'Rules.', cache: true }],
    messages: [{ role: 'user' as const, content: 'Ahoj' }],
  };
  const Schema = z.object({ index: z.int(), note: z.string().default('none') });

  describe(`AiGateway suite: ${name}`, () => {
    it('structured returns the answer parsed with the schema', async () => {
      const h = await setup();
      h.script('reader.disambiguate', { data: { index: 2 } });
      const res = await h.gateway.structured({
        ...base,
        route: 'reader.disambiguate',
        schema: Schema,
      });
      expect(res.data).toEqual({ index: 2, note: 'none' });
      expect(res.usage.model.length).toBeGreaterThan(0);
    });

    it('structured fails with upstream_failed when the answer does not match', async () => {
      const h = await setup();
      h.script('reader.disambiguate', { data: { index: 'two' } });
      const err = await h.gateway
        .structured({ ...base, route: 'reader.disambiguate', schema: Schema })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiGatewayError);
      expect((err as AiGatewayError).code).toBe('upstream_failed');
    });

    it('stream forwards every piece and returns the whole text', async () => {
      const h = await setup();
      h.script('tutor.reply', { text: ['S kým ', 'ideš do kina?'] });
      const pieces: string[] = [];
      const res = await h.gateway.stream({
        ...base,
        route: 'tutor.reply',
        onText: (d) => pieces.push(d),
      });
      expect(res.text).toBe('S kým ideš do kina?');
      expect(pieces.join('')).toBe(res.text);
      expect(pieces.length).toBeGreaterThanOrEqual(1);
    });

    it('a stream aborted mid way rejects with an AbortError', async () => {
      const h = await setup();
      h.script('tutor.reply', { text: ['a ', 'b ', 'c ', 'd'] });
      const ctrl = new AbortController();
      const err = await h.gateway
        .stream({ ...base, route: 'tutor.reply', signal: ctrl.signal, onText: () => ctrl.abort() })
        .catch((e: unknown) => e);
      expect((err as Error).name).toBe('AbortError');
    });

    for (const code of ['refused', 'truncated', 'upstream_failed'] as const) {
      it(`a ${code} answer becomes AiGatewayError ${code} and a usage row`, async () => {
        const h = await setup();
        h.script('tutor.summary', { error: code });
        const err = await h.gateway
          .structured({ ...base, route: 'tutor.summary', schema: Schema })
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AiGatewayError);
        expect((err as AiGatewayError).code).toBe(code);
        expect(h.rows).toHaveLength(1);
        expect(h.rows[0]?.status).toBe(
          code === 'refused' ? 'refused' : code === 'truncated' ? 'truncated' : 'error',
        );
      });
    }

    it('writes one usage row per call with the cost it returns', async () => {
      const h = await setup();
      h.script('reader.translate', { data: { index: 1 }, usage: { costUsd: 0.25 } });
      const res = await h.gateway.structured({
        ...base,
        route: 'reader.translate',
        schema: Schema,
      });
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0]).toMatchObject({
        userId: USER,
        route: 'reader.translate',
        status: 'ok',
        model: res.usage.model,
        costUsd: res.usage.costUsd,
      });
    });

    it('stops at the daily budget with budget_exceeded and calls no model', async () => {
      const h = await setup(0.5);
      h.script('reader.gloss', { data: { index: 1 }, usage: { costUsd: 0.5 } });
      await h.gateway.structured({ ...base, route: 'reader.gloss', schema: Schema });
      const calls = h.modelCalls();
      h.script('reader.gloss', { data: { index: 1 } });
      const err = await h.gateway
        .structured({ ...base, route: 'reader.gloss', schema: Schema })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiGatewayError);
      expect((err as AiGatewayError).code).toBe('budget_exceeded');
      expect((err as AiGatewayError).details.resetsAt).toBe(RESETS);
      expect(h.modelCalls()).toBe(calls);
      expect(h.rows).toHaveLength(1);
      // Another learner still has budget.
      await h.gateway.structured({
        ...base,
        userId: '0195f3a0-0000-7000-8000-000000000002',
        route: 'reader.gloss',
        schema: Schema,
      });
    });
  });
}
