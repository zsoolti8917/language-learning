import { clearLocalData } from '../db/db';
import type { ClientEnv } from '../env';
import { createDevAuth } from './dev';
import { createSupabaseAuth } from './supabase';
import type { AuthClient, CodePurpose, Session } from './types';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

export interface AuthSnapshot {
  status: AuthStatus;
  session: Session | null;
}

/** Picks the login mode from the client variables. */
export function createAuthClient(env: ClientEnv): AuthClient {
  if (env.authMode === 'supabase') {
    if (!env.supabaseUrl || !env.supabasePublishableKey) {
      throw new Error('VITE_AUTH_MODE=supabase needs VITE_SUPABASE_URL and the publishable key.');
    }
    return createSupabaseAuth({ url: env.supabaseUrl, publishableKey: env.supabasePublishableKey });
  }
  return createDevAuth();
}

/**
 * The login state outside React, for the route guards and the API client. React reads it
 * through `useAuth()`.
 */
export class AuthStore {
  readonly client: AuthClient;
  private snapshot: AuthSnapshot = { status: 'loading', session: null };
  private readonly listeners = new Set<() => void>();
  private readonly readyPromise: Promise<void>;
  private onSignOut: (() => void | Promise<void>) | undefined;

  constructor(client: AuthClient, options: { onSignOut?: () => void | Promise<void> } = {}) {
    this.client = client;
    this.onSignOut = options.onSignOut;
    client.onChange((session) => this.set(session));
    this.readyPromise = client
      .getSession()
      .catch(() => null)
      .then((s) => {
        // An onChange event may have arrived first; keep the later one.
        if (this.snapshot.status === 'loading') this.set(s);
      });
  }

  /** Resolves once the stored session has been read. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  getSnapshot = (): AuthSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get session(): Session | null {
    return this.snapshot.session;
  }

  /** The bearer token for the next API call (Supabase refreshes it when it is close to expiry). */
  async getToken(): Promise<string | null> {
    await this.readyPromise;
    if (this.client.mode === 'supabase' && this.snapshot.session) {
      const s = await this.client.getSession().catch(() => this.snapshot.session);
      return s?.accessToken ?? null;
    }
    return this.snapshot.session?.accessToken ?? null;
  }

  /** After a 401: try a refresh; sign out locally when it fails. Returns true when refreshed. */
  async refreshAfterUnauthorized(): Promise<boolean> {
    const s = await this.client.refresh().catch(() => null);
    if (s && s.accessToken !== this.snapshot.session?.accessToken) {
      this.set(s);
      return true;
    }
    await this.signOut();
    return false;
  }

  signIn = async (email: string, password: string) =>
    this.set(await this.client.signIn(email, password));
  signUp = (email: string, password: string) => this.client.signUp(email, password);
  verifyCode = async (email: string, code: string, purpose: CodePurpose) =>
    this.set(await this.client.verifyCode(email, code, purpose));
  resendCode = (email: string, purpose: CodePurpose) => this.client.resendCode(email, purpose);
  requestPasswordReset = (email: string) => this.client.requestPasswordReset(email);
  updatePassword = (password: string) => this.client.updatePassword(password);

  /** Signs out and removes every learner row from the device. */
  signOut = async (): Promise<void> => {
    try {
      await this.client.signOut();
    } finally {
      this.set(null);
      await clearLocalData().catch(() => {});
      await this.onSignOut?.();
    }
  };

  setOnSignOut(f: () => void | Promise<void>) {
    this.onSignOut = f;
  }

  private set(session: Session | null) {
    const status: AuthStatus = session ? 'signedIn' : 'signedOut';
    if (this.snapshot.status === status && this.snapshot.session === session) return;
    this.snapshot = { status, session };
    for (const l of this.listeners) l();
  }
}
