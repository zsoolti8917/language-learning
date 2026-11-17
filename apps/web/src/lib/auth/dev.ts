// Dev login of local mode: a fixed user, and the token `dev:<uuid>` the API accepts when
// AUTH_MODE=dev. It behaves like Supabase so the account screens can be built against it.
import { type AuthClient, AuthError, type CodePurpose, type Session } from './types';

/** The fixed user of dev mode: the user id of the contract examples (`EXAMPLE_IDS.user`). */
export const DEV_USER_ID = '0193a1b2-c3d4-7e5f-8a6b-000000000001';
export const DEV_EMAIL = 'dev@example.test';
/** The only code dev mode accepts. */
export const DEV_CODE = '123456';
export const DEV_MIN_PASSWORD = 8;

const STORAGE_KEY = 'app.devSession';

export function devSession(userId = DEV_USER_ID, email: string | null = DEV_EMAIL): Session {
  return { userId, email, accessToken: `dev:${userId}`, expiresAt: null };
}

export interface DevAuthOptions {
  userId?: string;
  /** Where the session survives a reload; default localStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Start signed in (tests). */
  signedIn?: boolean;
}

export function createDevAuth(options: DevAuthOptions = {}): AuthClient {
  const userId = options.userId ?? DEV_USER_ID;
  const storage =
    options.storage === undefined
      ? typeof localStorage === 'undefined'
        ? null
        : localStorage
      : options.storage;
  const listeners = new Set<(s: Session | null) => void>();
  const pending = new Map<string, CodePurpose>();

  const read = (): Session | null => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  };
  let current: Session | null = options.signedIn ? devSession(userId) : read();

  const set = (s: Session | null) => {
    current = s;
    try {
      if (s) storage?.setItem(STORAGE_KEY, JSON.stringify(s));
      else storage?.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be blocked; the session then lasts for this page only.
    }
    for (const l of listeners) l(s);
  };

  const checkPassword = (password: string) => {
    if (password.length < DEV_MIN_PASSWORD) {
      throw new AuthError('weak_password', `Use at least ${DEV_MIN_PASSWORD} characters.`);
    }
  };

  return {
    mode: 'dev',
    async getSession() {
      return current;
    },
    async signUp(email, password) {
      checkPassword(password);
      pending.set(email, 'signup');
    },
    async verifyCode(email, code, purpose) {
      if (code !== DEV_CODE) throw new AuthError('invalid_code', 'The code is not right.');
      pending.delete(email);
      const s = devSession(userId, email);
      set(s);
      void purpose;
      return s;
    },
    async resendCode(email, purpose) {
      pending.set(email, purpose);
    },
    async signIn(email, password) {
      if (!password) throw new AuthError('invalid_credentials', 'Wrong email or password.');
      const s = devSession(userId, email || DEV_EMAIL);
      set(s);
      return s;
    },
    async requestPasswordReset(email) {
      pending.set(email, 'recovery');
    },
    async updatePassword(password) {
      checkPassword(password);
    },
    async refresh() {
      return current;
    },
    async signOut() {
      set(null);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
