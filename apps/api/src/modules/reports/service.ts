// Logic of the reports module. Owner: B7. It takes ports and a transaction and knows
// nothing about HTTP.
import type { CreateReport } from '@app/contracts';
import type { Tx } from '@app/db';
import { conflict, notFound, rateLimited } from '../../platform/errors';
import { learnerDay } from '../../platform/time';
import * as repo from './repo';

/** Reports a learner may file in one learner day. */
export const DAILY_REPORT_LIMIT = 30;

export type CreateOutcome = { id: string; created: boolean };

function sameReport(row: repo.ReportRow, body: CreateReport): boolean {
  return (
    row.targetKind === body.targetKind &&
    row.targetRef === body.targetRef &&
    (row.comment ?? null) === (body.comment ?? null)
  );
}

/**
 * Files a report. A repeat with the same content returns the stored one (`created: false`);
 * the same id with other content, or an id another learner holds, is a conflict. At most
 * 30 new reports per learner day.
 */
export async function createReport(
  tx: Tx,
  userId: string,
  body: CreateReport,
  now: Date,
): Promise<CreateOutcome> {
  const existing = await repo.findReport(tx, body.id);
  if (existing) {
    if (!sameReport(existing, body)) throw conflict('This report id holds another report.');
    return { id: existing.id, created: false };
  }
  const p = await repo.learnerDayOf(tx, userId);
  if (!p) throw notFound('No profile.');
  const day = learnerDay(now, p.timezone, p.dayStartHour);
  const filed = await repo.countReports(tx, userId, day.start, day.end);
  if (filed >= DAILY_REPORT_LIMIT)
    throw rateLimited(
      'Too many reports today.',
      Math.max(1, Math.ceil((day.end.getTime() - now.getTime()) / 1000)),
    );
  const inserted = await repo.insertReport(tx, {
    id: body.id,
    userId,
    targetKind: body.targetKind,
    targetRef: body.targetRef,
    comment: body.comment ?? null,
    createdAt: now,
  });
  if (!inserted) throw conflict('This report id is taken.');
  return { id: body.id, created: true };
}
