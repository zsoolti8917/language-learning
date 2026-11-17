-- Roles. Runs on Supabase and on PGlite alike.
-- `authenticated` exists on Supabase; elsewhere it is created here.
-- `app_api` is the role the API logs in with. It owns nothing, cannot bypass row level
-- security, inherits no rights, and may switch to `authenticated` (set local role).
-- Its password is never set here: set it once per project, outside the repository.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
GRANT authenticated TO app_api;
--> statement-breakpoint
-- The policies call auth.uid(). Supabase provides it; anywhere else it must exist before
-- the next migration runs (the test kit and local mode install it, see src/auth-stub.ts).
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is missing. Install the auth stub (installAuthStub) before migrating outside Supabase.';
  END IF;
END
$$;
