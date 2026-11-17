// The two usage functions on app.ai_call, the learner day, and the gateway's budget through
// them.
import { createConfiguredMock } from '@app/ai';
import { aiCall } from '@app/db';
import { createTestDb, type TestDb } from '@app/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixedClock, uuidV7Ids } from './clock';
import { learnerDay } from './time';
import { createUsageFunctions } from './usage';

const row = (userId: string, costUsd: number) => ({
  userId,
  route: 'reader.translate' as const,
  model: 'claude-opus-5-5',
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd,
  latencyMs: 812.4,
  status: 'ok' as const,
  requestId: 'req_1',
});

describe('learnerDay', () => {
  it('starts at the day start hour in the learner time zone', () => {
    // 08:30 UTC = 09:30 in Bratislava (winter, UTC+1): the day began at 04:00 local = 03:00 UTC.
    const d = learnerDay(new Date('2026-11-17T08:30:00Z'), 'Europe/Bratislava', 4);
    expect(d.start.toISOString()).toBe('2026-11-17T03:00:00.000Z');
    expect(d.end.toISOString()).toBe('2026-11-18T03:00:00.000Z');
    // 02:30 UTC = 03:30 local: still the previous learner day.
    const early = learnerDay(new Date('2026-11-17T02:30:00Z'), 'Europe/Bratislava', 4);
    expect(early.start.toISOString()).toBe('2026-11-16T03:00:00.000Z');
  });

  it('handles zones west of UTC and summer time', () => {
    const ny = learnerDay(new Date('2026-11-17T08:30:00Z'), 'America/New_York', 4);
    expect(ny.start.toISOString()).toBe('2026-11-16T09:00:00.000Z');
    // The night summer time ends in Europe (25 October 2026): that day lasts 25 hours.
    const dst = learnerDay(new Date('2026-10-25T12:00:00Z'), 'Europe/Bratislava', 4);
    expect(dst.start.toISOString()).toBe('2026-10-25T03:00:00.000Z');
    expect(dst.end.toISOString()).toBe('2026-10-26T03:00:00.000Z');
    const summer = learnerDay(new Date('2026-10-24T12:00:00Z'), 'Europe/Bratislava', 4);
    expect(summer.start.toISOString()).toBe('2026-10-24T02:00:00.000Z');
    expect(summer.end.toISOString()).toBe('2026-10-25T03:00:00.000Z');
  });

  it('falls back to UTC for an unknown zone', () => {
    const d = learnerDay(new Date('2026-11-17T08:30:00Z'), 'Mars/Olympus', 0);
    expect(d.start.toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });
});

describe('usage functions', () => {
  let db: TestDb;
  const clock = createFixedClock('2026-11-17T08:30:00Z');
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(() => db.close());

  it('a written row counts toward that learner spend only', async () => {
    const usage = createUsageFunctions({ database: db, clock, ids: uuidV7Ids });
    const a = (await db.factory.profile()).userId;
    const b = (await db.factory.profile()).userId;
    expect(await usage.spendToday(a)).toEqual({
      spentUsd: 0,
      resetsAt: '2026-11-18T03:00:00.000Z',
    });
    await usage.recordUsage(row(a, 0.125));
    await usage.recordUsage(row(a, 0.25));
    await usage.recordUsage(row(b, 0.5));
    expect((await usage.spendToday(a)).spentUsd).toBeCloseTo(0.375, 6);
    expect((await usage.spendToday(b)).spentUsd).toBeCloseTo(0.5, 6);
    const [stored] = await db.db.select().from(aiCall).where(eq(aiCall.userId, b));
    expect(stored).toMatchObject({ costUsd: '0.500000', latencyMs: 812, status: 'ok' });
    expect(stored?.createdAt.toISOString()).toBe('2026-11-17T08:30:00.000Z');
  });

  it('the spend starts again at the learner day start, in the learner time zone', async () => {
    const c = createFixedClock('2026-11-17T08:30:00Z');
    const usage = createUsageFunctions({ database: db, clock: c, ids: uuidV7Ids });
    const ny = (await db.factory.profile({ timezone: 'America/New_York', dayStartHour: 6 })).userId;
    // 08:30 UTC = 03:30 in New York: the learner day began 2026-11-16 06:00 local (11:00 UTC).
    await usage.recordUsage(row(ny, 0.3));
    const before = await usage.spendToday(ny);
    expect(before).toEqual({ spentUsd: 0.3, resetsAt: '2026-11-17T11:00:00.000Z' });
    c.set('2026-11-17T10:59:59Z');
    expect((await usage.spendToday(ny)).spentUsd).toBeCloseTo(0.3, 6);
    c.set('2026-11-17T11:00:00Z');
    expect(await usage.spendToday(ny)).toEqual({
      spentUsd: 0,
      resetsAt: '2026-11-18T11:00:00.000Z',
    });
  });

  it('the gateway stops at the budget and resumes on the next learner day', async () => {
    const c = createFixedClock('2026-11-17T08:30:00Z');
    const usage = createUsageFunctions({ database: db, clock: c, ids: uuidV7Ids });
    const gw = createConfiguredMock({ mode: 'mock', dailyBudgetUsd: 1, ...usage });
    const user = (await db.factory.profile()).userId;
    const { z } = await import('zod');
    const req = {
      route: 'reader.translate' as const,
      userId: user,
      system: [{ text: 'x', cache: true }],
      messages: [{ role: 'user' as const, content: 'Ahoj.' }],
      schema: z.object({ en: z.string() }),
    };
    gw.script('reader.translate', { data: { en: 'Hi.' }, usage: { costUsd: 1 } });
    await gw.structured(req);
    await expect(gw.structured(req)).rejects.toMatchObject({
      code: 'budget_exceeded',
      details: { resetsAt: '2026-11-18T03:00:00.000Z' },
    });
    c.set('2026-11-18T03:00:00Z');
    gw.script('reader.translate', { data: { en: 'Hi.' } });
    expect((await gw.structured(req)).data.en).toBe('Hi.');
  });
});
