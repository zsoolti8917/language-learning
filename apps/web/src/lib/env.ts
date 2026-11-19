// Client variables (docs/contracts.md, "Client variables"). Read once, here only.

export type AuthMode = 'supabase' | 'dev';

export interface ClientEnv {
  /** Base path of the API, default `/api/v1`. */
  apiBase: string;
  authMode: AuthMode;
  supabaseUrl: string;
  supabasePublishableKey: string;
  /** `true` starts the mock server in the browser. */
  mockApi: boolean;
  /** `false` (VITE_SIGNUP=closed) hides sign up: the app is private to existing accounts. */
  signupOpen: boolean;
}

export function readEnv(raw: Record<string, string | boolean | undefined>): ClientEnv {
  const str = (k: string) => {
    const v = raw[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  return {
    apiBase: str('VITE_API_BASE') || '/api/v1',
    authMode: str('VITE_AUTH_MODE') === 'supabase' ? 'supabase' : 'dev',
    supabaseUrl: str('VITE_SUPABASE_URL'),
    supabasePublishableKey: str('VITE_SUPABASE_PUBLISHABLE_KEY'),
    mockApi: str('VITE_MOCK_API') === 'true',
    signupOpen: str('VITE_SIGNUP') !== 'closed',
  };
}

export const env: ClientEnv = readEnv(import.meta.env as Record<string, string | boolean>);
