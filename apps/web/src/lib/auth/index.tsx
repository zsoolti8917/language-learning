import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import type { AuthSnapshot, AuthStore } from './store';

export {
  createDevAuth,
  DEV_CODE,
  DEV_EMAIL,
  DEV_MIN_PASSWORD,
  DEV_USER_ID,
  devSession,
} from './dev';
export { isFirstRun, loadProfile, PROFILE_KV_KEY } from './profile';
export { type AuthSnapshot, type AuthStatus, AuthStore, createAuthClient } from './store';
export { createSupabaseAuth, mapSupabaseError } from './supabase';
export {
  type AuthClient,
  AuthError,
  type AuthErrorCode,
  type CodePurpose,
  type Session,
} from './types';

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ store, children }: { store: AuthStore; children: ReactNode }) {
  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>;
}

export function useAuthStore(): AuthStore {
  const store = useContext(AuthContext);
  if (!store) throw new Error('useAuth needs an <AuthProvider>.');
  return store;
}

/**
 * The login state and actions:
 * `const { status, session, signIn, signUp, verifyCode, resendCode, requestPasswordReset,
 * updatePassword, signOut, mode } = useAuth()`. Actions reject with `AuthError`.
 */
export function useAuth(): AuthSnapshot & {
  mode: AuthStore['client']['mode'];
  signIn: AuthStore['signIn'];
  signUp: AuthStore['signUp'];
  verifyCode: AuthStore['verifyCode'];
  resendCode: AuthStore['resendCode'];
  requestPasswordReset: AuthStore['requestPasswordReset'];
  updatePassword: AuthStore['updatePassword'];
  signOut: AuthStore['signOut'];
} {
  const store = useAuthStore();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    ...snap,
    mode: store.client.mode,
    signIn: store.signIn,
    signUp: store.signUp,
    verifyCode: store.verifyCode,
    resendCode: store.resendCode,
    requestPasswordReset: store.requestPasswordReset,
    updatePassword: store.updatePassword,
    signOut: store.signOut,
  };
}
