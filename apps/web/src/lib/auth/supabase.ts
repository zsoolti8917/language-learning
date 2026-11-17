// Supabase mode: email and password with six digit codes (docs/architecture.md,
// "From login to a database row"). The library is loaded on first use, so it stays out of
// the first load. It keeps the session on the device and refreshes the token itself.
import type { Session as SbSession, SupabaseClient } from '@supabase/supabase-js';
import { type AuthClient, AuthError, type AuthErrorCode, type Session } from './types';

export interface SupabaseAuthOptions {
  url: string;
  publishableKey: string;
  /** For tests: a ready client instead of loading the library. */
  client?: Pick<SupabaseClient, 'auth'>;
}

function toSession(s: SbSession | null): Session | null {
  if (!s) return null;
  return {
    userId: s.user.id,
    email: s.user.email ?? null,
    accessToken: s.access_token,
    expiresAt: s.expires_at ?? null,
  };
}

const CODE_MAP: Record<string, AuthErrorCode> = {
  invalid_credentials: 'invalid_credentials',
  email_not_confirmed: 'invalid_credentials',
  otp_expired: 'invalid_code',
  otp_disabled: 'invalid_code',
  weak_password: 'weak_password',
  user_already_exists: 'email_taken',
  email_exists: 'email_taken',
  over_email_send_rate_limit: 'rate_limited',
  over_request_rate_limit: 'rate_limited',
};

/** Maps a Supabase error onto the app's codes. */
export function mapSupabaseError(e: unknown): AuthError {
  if (e instanceof AuthError) return e;
  const err = e as { name?: string; code?: string; status?: number; message?: string };
  const message = err?.message ?? 'Login failed.';
  if (err?.name === 'AuthRetryableFetchError' || err?.status === 0 || e instanceof TypeError) {
    return new AuthError('network', message);
  }
  const mapped = err?.code ? CODE_MAP[err.code] : undefined;
  if (mapped) return new AuthError(mapped, message);
  if (err?.status === 429) return new AuthError('rate_limited', message);
  return new AuthError('unknown', message);
}

export function createSupabaseAuth(options: SupabaseAuthOptions): AuthClient {
  let clientPromise: Promise<Pick<SupabaseClient, 'auth'>> | null = null;
  const listeners = new Set<(s: Session | null) => void>();
  let subscribed = false;

  async function client() {
    clientPromise ??= options.client
      ? Promise.resolve(options.client)
      : import('@supabase/supabase-js').then(({ createClient }) =>
          createClient(options.url, options.publishableKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          }),
        );
    const c = await clientPromise;
    if (!subscribed) {
      subscribed = true;
      c.auth.onAuthStateChange((_event, s) => {
        const session = toSession(s);
        for (const l of listeners) l(session);
      });
    }
    return c;
  }

  async function run<T>(f: (c: Pick<SupabaseClient, 'auth'>) => Promise<T>): Promise<T> {
    try {
      return await f(await client());
    } catch (e) {
      throw mapSupabaseError(e);
    }
  }

  function check<R extends { error: unknown }>(r: R): R extends { data: infer D } ? D : undefined {
    if (r.error) throw mapSupabaseError(r.error);
    return (r as { data?: unknown }).data as R extends { data: infer D } ? D : undefined;
  }

  return {
    mode: 'supabase',
    getSession: () => run(async (c) => toSession(check(await c.auth.getSession()).session)),
    signUp: (email, password) =>
      run(async (c) => {
        check(await c.auth.signUp({ email, password }));
      }),
    verifyCode: (email, code, purpose) =>
      run(async (c) => {
        const data = check(
          await c.auth.verifyOtp({
            email,
            token: code,
            type: purpose === 'signup' ? 'signup' : 'recovery',
          }),
        );
        const s = toSession(data.session);
        if (!s) throw new AuthError('invalid_code', 'The code is not right.');
        return s;
      }),
    resendCode: (email, purpose) =>
      run(async (c) => {
        if (purpose === 'recovery') check(await c.auth.resetPasswordForEmail(email));
        else check(await c.auth.resend({ type: 'signup', email }));
      }),
    signIn: (email, password) =>
      run(async (c) => {
        const s = toSession(check(await c.auth.signInWithPassword({ email, password })).session);
        if (!s) throw new AuthError('invalid_credentials', 'Wrong email or password.');
        return s;
      }),
    requestPasswordReset: (email) =>
      run(async (c) => {
        check(await c.auth.resetPasswordForEmail(email));
      }),
    updatePassword: (password) =>
      run(async (c) => {
        check(await c.auth.updateUser({ password }));
      }),
    refresh: () =>
      run(async (c) => {
        const r = await c.auth.refreshSession();
        if (r.error) return null;
        return toSession(r.data.session);
      }),
    signOut: () =>
      run(async (c) => {
        check(await c.auth.signOut());
      }),
    onChange(listener) {
      listeners.add(listener);
      void client();
      return () => listeners.delete(listener);
    },
  };
}
