// Small builders shared by both schemas: enum checks and the owner policies.
import { sql } from 'drizzle-orm';
import { check, pgPolicy, pgRole } from 'drizzle-orm/pg-core';

/** The role Supabase signs learners in as. Created by migration 0000 when it is missing. */
export const authenticated = pgRole('authenticated').existing();

function literal(v: string | number): string {
  return typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`;
}

/**
 * A check constraint that holds a column to the values of a contract enum.
 * A null passes, so the same helper serves nullable columns.
 */
export function oneOf(table: string, column: string, values: readonly (string | number)[]) {
  return check(
    `${table}_${column}_check`,
    sql.raw(`"${column}" in (${values.map(literal).join(', ')})`),
  );
}

/** A check that every element of a text array is one of the values. */
export function allOf(table: string, column: string, values: readonly string[]) {
  return check(
    `${table}_${column}_check`,
    sql.raw(`"${column}" <@ array[${values.map(literal).join(', ')}]::text[]`),
  );
}

const OWNER = sql.raw('"user_id" = (select auth.uid())');

/**
 * Row level security for a learner table: the row's user_id must be the
 * signed in learner, in both `using` and `with check`. Append only tables get
 * no update policy.
 */
export function ownerPolicies(table: string, opts: { appendOnly?: boolean } = {}) {
  const policies = [
    pgPolicy(`${table}_select_own`, { for: 'select', to: authenticated, using: OWNER }),
    pgPolicy(`${table}_insert_own`, { for: 'insert', to: authenticated, withCheck: OWNER }),
    pgPolicy(`${table}_delete_own`, { for: 'delete', to: authenticated, using: OWNER }),
  ];
  if (!opts.appendOnly)
    policies.push(
      pgPolicy(`${table}_update_own`, {
        for: 'update',
        to: authenticated,
        using: OWNER,
        withCheck: OWNER,
      }),
    );
  return policies;
}
