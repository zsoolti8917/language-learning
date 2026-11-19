# Deploy

How to set up Supabase and Vercel for the app. Secrets (database passwords, secret keys,
the Claude key) never go into the repository; they live only in Supabase and Vercel.

## 1. Supabase database

The file [`deploy/supabase-setup.sql`](../deploy/supabase-setup.sql) holds every migration,
drizzle's record of them, and the mini dataset (72 lemmas, 9 lessons) as a first check. It
runs as one transaction, so a failure changes nothing. Regenerate it after a migration with
`pnpm --filter @app/db sql:bundle > deploy/supabase-setup.sql`.

1. Open the project in the Supabase dashboard, then **SQL Editor** in the left bar, then
   **New query**.
2. Paste the whole of `deploy/supabase-setup.sql` (open the file on GitHub, press **Raw**,
   select all, copy). Press **Run**. It should end with "Success. No rows returned".
3. In a new query, give the API's login role a password. Make up a long random one with
   letters and digits only (no `@ : / ? #`, so it needs no escaping in a URL) and keep it in
   your password manager:

   ```sql
   ALTER ROLE app_api WITH PASSWORD 'your-long-random-password';
   ```

4. Check it worked, in a new query:

   ```sql
   SELECT version, (SELECT count(*) FROM ling.lemma) AS lemmas FROM ling.content_version;
   ```

   Expect one row: `2026-11-17.1` and `72`.

If step 2 fails with "permission denied to grant role authenticated", run
`GRANT authenticated TO app_api;` again on its own after the rest; if it still fails, send
the exact message.

## 2. Supabase settings

1. **Project Settings, Data API**: under **Exposed schemas** keep only `public` and
   `graphql_public`. Never add `app` or `ling`; the API reaches them, the browser does not.
2. **Project Settings, JWT Keys**: the current key should be **ECC (P-256)** or another
   asymmetric key. The API checks tokens against
   `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`. If only a legacy HS256
   secret is listed, press **Migrate JWT secret** and rotate to the new key.
3. **Authentication, Sign In / Providers, Email**: Email on, **Confirm email** on,
   **Email OTP length** 6. **Allow new users to sign up** on while you test.
4. **Authentication, Emails, Templates**: leave them as they are. With Supabase's built in
   sender the emails carry a link, and the app works with links: the sign up link returns
   to `/verify` and confirms the account, the reset link returns to `/reset` and asks for
   the new password. (With custom SMTP the templates could show `{{ .Token }}` instead;
   the app then still expects the link, so keep the link in the body.)
5. **Authentication, URL Configuration**: **Site URL** is the Vercel production address
   once it exists (for example `https://slovak.vercel.app`). Under **Redirect URLs** add
   `https://<that address>/**`, and `https://*-<team>.vercel.app/**` for previews, or the
   links fall back to the Site URL.
6. Supabase's built in mail sender allows only a few emails an hour. It is enough for
   testing; set up custom SMTP (**Authentication, Emails, SMTP Settings**) before others use
   the app.

## 3. Connection string for the API

1. Press **Connect** at the top of the project dashboard, choose **Transaction pooler**
   (port 6543), and copy the URI. It looks like
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres`.
2. Replace the user `postgres` with `app_api` and the password with the `app_api` password
   from step 1.3:
   `postgresql://app_api.<project-ref>:<app_api password>@aws-0-<region>.pooler.supabase.com:6543/postgres`.

This is `DATABASE_URL`. The API never logs in as `postgres`.

## 4. Vercel project

The repository builds itself in Vercel's Build Output API format (`pnpm run vercel-build`,
see `scripts/vercel-build.mjs`): the client as static files and the API as one Node 24
function at `/api` in `fra1` with a 300 second limit. `vercel.json` sets the commands, so on
the import page:

1. **Framework Preset**: Other.
2. **Root Directory**: `./` (the repository root, not `apps/web`).
3. **Build and Output Settings**: leave every override off; `vercel.json` sets the install
   command (`pnpm install --frozen-lockfile`) and the build command
   (`pnpm run vercel-build`). Output Directory is ignored, because the build writes
   `.vercel/output` itself.
4. Add the variables of section 5, then press **Deploy**.
5. After the first deploy, **Project Settings, Functions**: the region shows Frankfurt
   (`fra1`). **Project Settings, General, Node.js Version**: 24.x.

## 5. Vercel environment variables

Set these under **Project Settings, Environment Variables**. "Secret" means mark it
Sensitive. Values for Preview and Production may differ once there is a second Supabase
project; until then both use the same one.

### Build

| Name | Value | Secret |
|---|---|---|
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so Vercel installs with the pnpm version in `package.json` (12) | no |

### Server

| Name | Value | Secret |
|---|---|---|
| `APP_ENV` | `production` for Production, `preview` for Preview | no |
| `DB_MODE` | `postgres` | no |
| `DATABASE_URL` | the `app_api` pooler URI from section 3 | yes |
| `AUTH_MODE` | `supabase` | no |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | no |
| `SUPABASE_SECRET_KEY` | the project's secret key (`sb_secret_…`, or the legacy `service_role` key); used only to delete a login when an account is deleted | yes |
| `AI_MODE` | `anthropic`. Preview may use `mock` until the Claude key is in; Production refuses to start with `mock` | no |
| `ANTHROPIC_API_KEY` | the Claude API key (required when `AI_MODE=anthropic`) | yes |
| `AI_DAILY_BUDGET_USD` | `1.00` | no |

### Client (built into the page, so never put a secret here)

| Name | Value |
|---|---|
| `VITE_API_BASE` | `/api/v1` |
| `VITE_AUTH_MODE` | `supabase` |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key (`sb_publishable_…`) |
| `VITE_MOCK_API` | `false` |

## 6. Later migrations

The setup script records the migrations it applied in `drizzle.__drizzle_migrations`, so a
later `pnpm --filter @app/db db:migrate` with `DATABASE_URL` set to the **direct**
connection as `postgres` applies only new ones.
