/** A signed in learner as the client sees it. */
export interface Session {
  userId: string;
  email: string | null;
  accessToken: string;
  /** Epoch seconds when the access token expires, if known. */
  expiresAt: number | null;
}

/** What a six digit code confirms: a new account, or a password reset. */
export type CodePurpose = 'signup' | 'recovery';

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'invalid_code'
  | 'weak_password'
  | 'email_taken'
  | 'rate_limited'
  | 'network'
  | 'unknown';

/** Every failed login call rejects with this; screens map `code` to a message. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** Login plumbing (docs/architecture.md, "Auth and security"). Two modes: Supabase and dev. */
export interface AuthClient {
  readonly mode: 'supabase' | 'dev';
  /**
   * True when the email carries a link instead of a code (Supabase's default emails). The
   * link signs the learner in on /verify or /reset; no code is typed.
   */
  readonly confirmsByLink?: boolean;
  /** The stored session, refreshed if it expired; null when signed out. */
  getSession(): Promise<Session | null>;
  /** Creates the account; Supabase emails a six digit code. */
  signUp(email: string, password: string): Promise<void>;
  /** Checks the code from the email. `signup` signs in; `recovery` signs in to set a password. */
  verifyCode(email: string, code: string, purpose: CodePurpose): Promise<Session>;
  /** Sends the code again. */
  resendCode(email: string, purpose: CodePurpose): Promise<void>;
  signIn(email: string, password: string): Promise<Session>;
  /** Emails a reset code. Follow with `verifyCode(email, code, 'recovery')` and `updatePassword`. */
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Gets a new access token; null when the session is gone. */
  refresh(): Promise<Session | null>;
  signOut(): Promise<void>;
  /** Called with every change of the session. Returns the unsubscribe function. */
  onChange(listener: (session: Session | null) => void): () => void;
}
