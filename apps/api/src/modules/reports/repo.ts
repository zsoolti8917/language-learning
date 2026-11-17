// SQL of the reports module (Drizzle). Owner: B7. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts.
import { contentReport, queryRows, type Tx } from '@app/db';
import { eq, sql } from 'drizzle-orm';

export type ReportRow = typeof contentReport.$inferSelect;
export type NewReport = Pick<
  typeof contentReport.$inferInsert,
  'id' | 'userId' | 'targetKind' | 'targetRef' | 'comment' | 'createdAt'
>;

/** The learner's report with this id; another learner's row is not visible (RLS). */
export async function findReport(tx: Tx, id: string): Promise<ReportRow | undefined> {
  const [row] = await tx.select().from(contentReport).where(eq(contentReport.id, id));
  return row;
}

/** Inserts the report; false when the id is taken (by any learner). */
export async function insertReport(tx: Tx, report: NewReport): Promise<boolean> {
  const rows = await tx
    .insert(contentReport)
    .values(report)
    .onConflictDoNothing({ target: contentReport.id })
    .returning({ id: contentReport.id });
  return rows.length > 0;
}

/** The learner's reports created in [start, end). */
export async function countReports(
  tx: Tx,
  userId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const [row] = await queryRows<{ n: unknown }>(
    tx,
    sql`select count(*) as n from app.content_report
        where user_id = ${userId}::uuid
          and created_at >= ${start.toISOString()}::timestamptz
          and created_at < ${end.toISOString()}::timestamptz`,
  );
  return Number(row?.n ?? 0);
}

/** The time zone and day start hour of the learner, for the daily limit. */
export async function learnerDayOf(
  tx: Tx,
  userId: string,
): Promise<{ timezone: string; dayStartHour: number } | undefined> {
  const [row] = await queryRows<{ timezone: string; day_start_hour: number }>(
    tx,
    sql`select timezone, day_start_hour from app.profile where user_id = ${userId}::uuid`,
  );
  return row ? { timezone: row.timezone, dayStartHour: Number(row.day_start_hour) } : undefined;
}
