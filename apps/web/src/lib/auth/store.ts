import { outbox } from '../db';
import { clearLocalData } from '../db/db';
import { claimLocalData, requestPersistentStorage } from '../db/storage';
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

/** What a change of login does to the rows on the device. */
export interface LocalDataHooks {
  /** Removes every learner row: a sign out. */
  clear(): Promise<void>;
  /** Makes the rows the given learner's before the app reads them (another learner's go). */
  claim(userId: string): Promise<unknown>;
  /** After a sign in (not the session found at start): persistent storage, waiting writes. */
  signedIn?(userId: string): void;
}

export const defaultLocalData: LocalDataHooks = {
  clear: () => clearLocalData(),
  claim: (userId) => claimLocalData(userId),
  signedIn: () => {
    void requestPersistentStorage();
    // Writes kept through an expired login go out now.
    outbox.syncNow().catch(() => {});
  },
};

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
  private readonly localData: LocalDataHooks;

  constructor(
    client: AuthClient,
    options: { onSignOut?: () => void | Promise<void>; localData?: LocalDataHooks } = {},
  ) {
    this.client = client;
    this.onSignOut = options.onSignOut;
    this.localData = options.localData ?? defaultLocalData;
    client.onChange((session) => void this.adopt(session));
    this.readyPromise = client
      .getSession()
      .catch(() => null)
      .then(async (s) => {
        if (s) await this.claim(s);
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

  /**
   * After a 401: try a refresh. When it fails the login has expired: the learner is signed out
   * of this page, but the rows on the device stay (unsent writes above all) and go out after
   * the same learner signs in again. Returns true when refreshed.
   */
  async refreshAfterUnauthorized(): Promise<boolean> {
    if (this.snapshot.status !== 'signedIn') return false;
    const s = await this.client.refresh().catch(() => null);
    if (s && s.accessToken !== this.snapshot.session?.accessToken) {
      this.set(s);
      return true;
    }
    await this.expire();
    return false;
  }

  /** The login expired: signed out here, the local rows kept for the same learner. */
  async expire(): Promise<void> {
    try {
      await this.client.signOut();
    } catch {
      // Already gone on the server side.
    } finally {
      this.set(null);
      await this.onSignOut?.();
    }
  }

  signIn = async (email: string, password: string) =>
    this.adopt(await this.client.signIn(email, password));
  signUp = (email: string, password: string) => this.client.signUp(email, password);
  verifyCode = async (email: string, code: string, purpose: CodePurpose) =>
    this.adopt(await this.client.verifyCode(email, code, purpose));
  resendCode = (email: string, purpose: CodePurpose) => this.client.resendCode(email, purpose);
  requestPasswordReset = (email: string) => this.client.requestPasswordReset(email);
  updatePassword = (password: string) => this.client.updatePassword(password);

  /** Signs out and removes every learner row from the device. */
  signOut = async (): Promise<void> => {
    try {
      await this.client.signOut();
    } finally {
      this.set(null);
      await this.localData.clear().catch(() => {});
      await this.onSignOut?.();
    }
  };

  setOnSignOut(f: () => void | Promise<void>) {
    this.onSignOut = f;
  }

  /** Rows of another learner go before the app reads them; a broken database is no reason to stop. */
  private async claim(session: Session) {
    await this.localData.claim(session.userId).catch(() => {});
  }

  /** A session from a sign in or a change event: claim the rows, then switch. */
  private async adopt(session: Session | null) {
    if (session) await this.claim(session);
    const fresh = session !== null && this.snapshot.status === 'signedOut';
    this.set(session);
    if (fresh && session) this.localData.signedIn?.(session.userId);
  }

  private set(session: Session | null) {
    const status: AuthStatus = session ? 'signedIn' : 'signedOut';
    if (this.snapshot.status === status && this.snapshot.session === session) return;
    this.snapshot = { status, session };
    for (const l of this.listeners) l();
  }
}
