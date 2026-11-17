// Helpers on an open transaction.
import { queryRows, type Tx } from '@app/db';
import { sql } from 'drizzle-orm';

/**
 * The learner of a `withUser` transaction (`auth.uid()`). Ports take only `tx`, so a port
 * implementation reads the user id from it. Throws inside `withSystem`.
 */
export async function currentUserId(tx: Tx): Promise<string> {
  const [row] = await queryRows<{ id: string | null }>(tx, sql`select auth.uid()::text as id`);
  if (!row?.id) throw new Error('currentUserId: not inside withUser');
  return row.id;
}
