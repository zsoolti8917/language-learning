// A stand in for the parts of Supabase Auth the migrations rely on: the role
// `authenticated` and the function `auth.uid()`, which reads the request claim the way
// Supabase does. Every statement is idempotent and leaves an existing function alone,
// so it is harmless on Supabase too. Tests and local mode run it before the migrations.
export const AUTH_STUB_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END
$$;
CREATE SCHEMA IF NOT EXISTS auth;
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS 'SELECT nullif(coalesce(
            nullif(current_setting(''request.jwt.claim.sub'', true), ''''),
            nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''sub''
          ), '''')::uuid';
  END IF;
END
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
`;
