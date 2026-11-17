// `pnpm seed:demo`: three weeks of history for one learner, made through the real API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { DEMO_USER, type DemoSummary, seedDemo } from './demo-seed';

describe('demo seed', () => {
  let t: TestApp;
  let first: DemoSummary;
  const now = new Date('2026-11-17T18:00:00.000Z');
  beforeAll(async () => {
    t = await createTestApp();
    first = await seedDemo({ app: t.app, clock: t.clock, drain: t.drain }, { now });
  }, 240_000);
  afterAll(async () => {
    await t?.close();
  });

  it('creates the dev user with a few weeks of daily practice in every feature', async () => {
    expect(first.userId).toBe(DEMO_USER);
    expect(first.days).toBe(21);
    expect(first.reviewDays).toBeGreaterThanOrEqual(14);
    expect(first.reviews).toBeGreaterThan(100);
    expect(first.notes).toBeGreaterThan(20);
    expect(first.attempts).toBeGreaterThan(100);
    expect(first.texts).toBe(2);
    expect(first.conversations).toBe(2);

    const me = t.as(DEMO_USER);
    const profile = await me.call('profile.get');
    expect(profile.body.displayName).toBe('Demo');
    expect(profile.body.placementDoneAt).not.toBeNull();
    expect(profile.body.settings.onboardedAt).toEqual(expect.any(String));
    // The history spans the three weeks before "now".
    const exported = await me.call('profile.export');
    const answered = (exported.body.tables.review ?? []).map((r: Record<string, unknown>) =>
      Date.parse(String(r.answeredAt)),
    );
    expect(Math.min(...answered)).toBeLessThan(now.getTime() - 19 * 86_400_000);
    expect(Math.max(...answered)).toBeLessThanOrEqual(t.clock.now().getTime());
    const course = await me.call('declension.course');
    expect(
      course.body.lessons.filter((l: { status: string }) => l.status === 'completed'),
    ).toHaveLength(3);
    expect(course.body.mastery.some((b: { level: string }) => b.level !== 'unseen')).toBe(true);
    const stats = await me.call('profile.stats');
    expect(stats.status).toBe(200);
    const today = await me.call('profile.today');
    expect(today.status).toBe(200);
  });

  it('starts over when run again, with the same history', async () => {
    const again = await seedDemo({ app: t.app, clock: t.clock, drain: t.drain }, { now });
    expect(again).toEqual(first);
  }, 240_000);
});
