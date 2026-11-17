import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createDevAuth, DEV_CODE, DEV_USER_ID } from './dev';
import { AuthProvider, isFirstRun, useAuth } from './index';
import { AuthStore } from './store';
import { createSupabaseAuth, mapSupabaseError } from './supabase';
import { AuthError } from './types';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('dev login', () => {
  it('signs up with a code, keeps the session across a reload, and signs out', async () => {
    const storage = memoryStorage();
    const auth = createDevAuth({ storage });
    expect(await auth.getSession()).toBeNull();
    await expect(auth.signUp('a@b.test', 'short')).rejects.toMatchObject({ code: 'weak_password' });
    await auth.signUp('a@b.test', 'long enough');
    await expect(auth.verifyCode('a@b.test', '000000', 'signup')).rejects.toMatchObject({
      code: 'invalid_code',
    });
    const s = await auth.verifyCode('a@b.test', DEV_CODE, 'signup');
    expect(s).toMatchObject({ userId: DEV_USER_ID, accessToken: `dev:${DEV_USER_ID}` });

    const reloaded = createDevAuth({ storage });
    expect(await reloaded.getSession()).toEqual(s);
    await reloaded.signOut();
    expect(await createDevAuth({ storage }).getSession()).toBeNull();
  });
});

describe('Supabase login', () => {
  function fakeSupabase() {
    const session = {
      access_token: 'jwt',
      expires_at: 123,
      user: { id: 'u1', email: 'a@b.test' },
    };
    const auth = {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      signUp: vi.fn(async () => ({ data: {}, error: null })),
      verifyOtp: vi.fn(async () => ({ data: { session }, error: null })),
      signInWithPassword: vi.fn(async () => ({
        data: { session: null },
        error: { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'no' },
      })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      resend: vi.fn(async () => ({ data: {}, error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    };
    return auth;
  }

  it('maps sign up, codes, reset and refresh onto Supabase calls', async () => {
    const sb = fakeSupabase();
    const auth = createSupabaseAuth({
      url: 'x',
      publishableKey: 'y',
      client: { auth: sb } as never,
    });
    await auth.signUp('a@b.test', 'secret123');
    expect(sb.signUp).toHaveBeenCalledWith({ email: 'a@b.test', password: 'secret123' });
    expect(await auth.verifyCode('a@b.test', '123456', 'signup')).toEqual({
      userId: 'u1',
      email: 'a@b.test',
      accessToken: 'jwt',
      expiresAt: 123,
    });
    expect(sb.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.test',
      token: '123456',
      type: 'signup',
    });
    await auth.requestPasswordReset('a@b.test');
    await auth.verifyCode('a@b.test', '654321', 'recovery');
    expect(sb.verifyOtp).toHaveBeenLastCalledWith({
      email: 'a@b.test',
      token: '654321',
      type: 'recovery',
    });
    await auth.updatePassword('new secret');
    expect(sb.updateUser).toHaveBeenCalledWith({ password: 'new secret' });
    await auth.resendCode('a@b.test', 'signup');
    expect(sb.resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@b.test' });
    expect((await auth.refresh())?.accessToken).toBe('jwt');
    await expect(auth.signIn('a@b.test', 'x')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('maps errors to app codes', () => {
    expect(mapSupabaseError({ code: 'otp_expired', message: 'x' }).code).toBe('invalid_code');
    expect(mapSupabaseError({ code: 'weak_password', message: 'x' }).code).toBe('weak_password');
    expect(mapSupabaseError({ name: 'AuthRetryableFetchError', message: 'x' }).code).toBe(
      'network',
    );
    expect(mapSupabaseError({ status: 429, message: 'x' }).code).toBe('rate_limited');
    expect(mapSupabaseError(new Error('x'))).toBeInstanceOf(AuthError);
  });
});

describe('AuthStore and useAuth', () => {
  it('tracks the session and refreshes after a 401', async () => {
    const client = createDevAuth({ storage: null });
    const store = new AuthStore(client);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider store={store}>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(() => store.ready());
    expect(result.current.status).toBe('signedOut');
    await act(() => result.current.signIn('a@b.test', 'pw'));
    expect(result.current.status).toBe('signedIn');
    expect(await store.getToken()).toBe(`dev:${DEV_USER_ID}`);
    // Dev refresh returns the same token: not a real refresh, so the store signs out.
    await act(async () => {
      expect(await store.refreshAfterUnauthorized()).toBe(false);
    });
    expect(result.current.status).toBe('signedOut');
  });
});

describe('first run', () => {
  it('holds until onboarding or placement is done', () => {
    expect(isFirstRun({ settings: {}, placementDoneAt: null })).toBe(true);
    expect(isFirstRun({ settings: { onboardedAt: 'x' }, placementDoneAt: null })).toBe(false);
    expect(isFirstRun({ settings: {}, placementDoneAt: '2026-11-17T08:00:00.000Z' })).toBe(false);
  });
});
