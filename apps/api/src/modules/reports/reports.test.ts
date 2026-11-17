// B7: POST /reports, with its repeat rule and its limit of 30 a learner day.
import { ReportCreatedSchema } from '@app/contracts';
import { contentReport } from '@app/db';
import { createTestDb, type TestDb, uuidv7 } from '@app/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/app';
import { DAILY_REPORT_LIMIT } from './service';

let db: TestDb;
let t: TestApp;

beforeAll(async () => {
  db = await createTestDb({ content: 'mini' });
  t = await createTestApp({ db });
});
afterAll(async () => {
  await t.close();
  await db.close();
});
beforeEach(() => {
  t.clock.set('2026-11-17T08:30:00.000Z');
});

const report = (over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  targetKind: 'exercise',
  targetRef: 'ex-3fa94c21d0',
  comment: 'The translation sounds odd.',
  ...over,
});

const stored = async (id: string) =>
  (await db.db.select().from(contentReport).where(eq(contentReport.id, id)))[0];

describe('POST /reports', () => {
  it('stores the report as the learner and answers 201 with its id', async () => {
    const me = t.as();
    const body = report();
    const res = await me.post('/reports', body);
    expect(res.status).toBe(201);
    expect(ReportCreatedSchema.parse(res.body)).toEqual({ id: body.id });
    expect(await stored(body.id)).toMatchObject({
      userId: me.id,
      targetKind: 'exercise',
      targetRef: 'ex-3fa94c21d0',
      comment: 'The translation sounds odd.',
      status: 'open',
      createdAt: new Date('2026-11-17T08:30:00.000Z'),
    });
  });

  it('a comment is optional', async () => {
    const body = report({ comment: undefined, targetKind: 'sense', targetRef: '20:1' });
    const res = await t.as().post('/reports', body);
    expect(res.status).toBe(201);
    expect((await stored(body.id))?.comment).toBeNull();
  });

  it('a repeat returns the stored report with 200 and changes nothing', async () => {
    const me = t.as();
    const body = report();
    expect((await me.post('/reports', body)).status).toBe(201);
    t.clock.advance(60_000);
    const again = await me.post('/reports', body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id: body.id });
    expect((await stored(body.id))?.createdAt).toEqual(new Date('2026-11-17T08:30:00.000Z'));
  });

  it('the same id with other content is a conflict', async () => {
    const me = t.as();
    const body = report();
    await me.post('/reports', body);
    const res = await me.post('/reports', { ...body, comment: 'Something else.' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('refuses an unknown target kind and a long comment', async () => {
    const me = t.as();
    const a = await me.post('/reports', report({ targetKind: 'planet' }));
    expect(a.status).toBe(400);
    expect(a.body.error.details.fields).toHaveProperty('body.targetKind');
    const b = await me.post('/reports', report({ comment: 'x'.repeat(1001) }));
    expect(b.status).toBe(400);
  });

  it('allows 30 reports a learner day, then answers 429 until the day ends', async () => {
    const id = uuidv7();
    // A New York learner: at 08:30Z the day runs until 09:00Z.
    await db.factory.profile({ userId: id, timezone: 'America/New_York' });
    const me = t.as(id);
    // One report from yesterday (New York) does not count.
    await db.factory.contentReport({ userId: id, createdAt: new Date('2026-11-16T08:00:00Z') });
    for (let i = 0; i < DAILY_REPORT_LIMIT; i++) {
      const res = await me.post('/reports', report());
      expect(res.status, `report ${i + 1}`).toBe(201);
    }
    const body = report();
    const over = await me.post('/reports', body);
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('rate_limited');
    expect(over.body.error.details.retryAfterSeconds).toBe(30 * 60);
    expect(await stored(body.id)).toBeUndefined();

    // Another learner is not limited.
    expect((await t.as().post('/reports', report())).status).toBe(201);

    // The next learner day starts at 04:00 New York, 09:00Z.
    t.clock.set('2026-11-17T09:00:00.000Z');
    expect((await me.post('/reports', body)).status).toBe(201);
  });

  it("isolation: learner B cannot read or overwrite learner A's report through its id", async () => {
    const a = t.as();
    const body = report();
    await a.post('/reports', body);
    const b = t.as();
    // Same content: B gets no copy of A's row; the id is taken.
    const same = await b.post('/reports', body);
    expect(same.status).toBe(409);
    expect(same.text).not.toContain(a.id as string);
    const other = await b.post('/reports', { ...body, comment: 'B' });
    expect(other.status).toBe(409);
    expect(await stored(body.id)).toMatchObject({
      userId: a.id,
      comment: 'The translation sounds odd.',
    });
  });
});
