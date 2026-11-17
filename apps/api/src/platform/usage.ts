// The two usage functions of the gateway's config, on `app.ai_call`: a learner's spend of
// the current learner day, and one usage row per model call. Each runs in a short
// transaction of its own, never while a model call is open.
import type { UsageFunctions } from '@app/ai';
import { aiCall, type Database, profile } from '@app/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Clock, IdGenerator } from '../ports';
import { learnerDay } from './time';

const DEFAULT_TZ = 'Europe/Bratislava';
const DEFAULT_DAY_START = 4;

export function createUsageFunctions(deps: {
  database: Database;
  clock: Clock;
  ids: IdGenerator;
}): UsageFunctions {
  const { database, clock, ids } = deps;
  return {
    spendToday: (userId) =>
      database.withUser(userId, async (tx) => {
        const [p] = await tx
          .select({ timezone: profile.timezone, dayStartHour: profile.dayStartHour })
          .from(profile)
          .where(eq(profile.userId, userId));
        const day = learnerDay(
          clock.now(),
          p?.timezone ?? DEFAULT_TZ,
          p?.dayStartHour ?? DEFAULT_DAY_START,
        );
        const [row] = await tx
          .select({ total: sql<string | null>`sum(${aiCall.costUsd})` })
          .from(aiCall)
          .where(and(eq(aiCall.userId, userId), gte(aiCall.createdAt, day.start)));
        return { spentUsd: Number(row?.total ?? 0), resetsAt: day.end.toISOString() };
      }),

    recordUsage: (row) =>
      database.withUser(row.userId, async (tx) => {
        await tx.insert(aiCall).values({
          id: ids.uuid(),
          userId: row.userId,
          route: row.route,
          model: row.model,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheWriteTokens: row.cacheWriteTokens,
          costUsd: row.costUsd.toFixed(6),
          latencyMs: Math.round(row.latencyMs),
          status: row.status,
          requestId: row.requestId,
          createdAt: clock.now(),
        });
      }),
  };
}
