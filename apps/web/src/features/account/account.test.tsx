import type { Profile, UpdateProfile } from '@app/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AuthClient, AuthError, createDevAuth } from '../../lib/auth';
import { env } from '../../lib/env';
import { en } from '../../messages';
import { mockEndpoint, mockNetworkError, renderRoute, server } from '../../test/utils';
import { EXAMPLE_PROFILE, FRESH_PROFILE } from '../today/fixtures';
import { m as tm } from '../today/messages';
import { m } from './messages';
import { readPending, writePending } from './pending';

afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

/** The dev login, signed out, with some methods replaced. */
function fakeAuth(overrides: Partial<AuthClient> = {}): AuthClient {
  return { ...createDevAuth({ storage: null }), ...overrides };
}

/** A promise the test settles by hand, to see the screen while a call is running. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const field = (name: string) => screen.getByLabelText(name);

describe('login', () => {
  it('checks the fields before sending', async () => {
    const signIn = vi.fn();
    renderRoute('/login', { auth: fakeAuth({ signIn }) });
    await screen.findByRole('heading', { name: en.screens.login, level: 1 });
    await userEvent.click(screen.getByRole('button', { name: m.t('login.submit') }));
    expect(screen.getByText(m.t('errors.emailRequired'))).toBeInTheDocument();
    expect(screen.getByText(m.t('errors.passwordRequired'))).toBeInTheDocument();
    await userEvent.type(field(m.t('fields.email')), 'not-an-email');
    expect(screen.getByText(m.t('errors.emailInvalid'))).toBeInTheDocument();
    expect(field(m.t('fields.email'))).toHaveAttribute('aria-invalid', 'true');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows wrong credentials and a network error', async () => {
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(new AuthError('invalid_credentials', 'x'))
      .mockRejectedValueOnce(new AuthError('network', 'x'));
    renderRoute('/login', { auth: fakeAuth({ signIn }) });
    await userEvent.type(await screen.findByLabelText(m.t('fields.email')), 'a@b.sk');
    await userEvent.type(field(m.t('fields.password')), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: m.t('login.submit') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.t('errors.invalid_credentials'));
    await userEvent.click(screen.getByRole('button', { name: m.t('login.submit') }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(m.t('errors.network')));
    expect(signIn).toHaveBeenCalledWith('a@b.sk', 'secret123');
  });

  it('disables the form while sending, then goes where the visitor wanted', async () => {
    const auth = fakeAuth();
    const call = deferred();
    const realSignIn = auth.signIn;
    auth.signIn = async (email, password) => {
      await call.promise;
      return realSignIn(email, password);
    };
    const { router } = renderRoute('/login?redirect=%2Fsettings', { auth });
    await userEvent.type(await screen.findByLabelText(m.t('fields.email')), 'a@b.sk');
    await userEvent.type(field(m.t('fields.password')), 'secret123');
    const submit = screen.getByRole('button', { name: m.t('login.submit') });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(field(m.t('fields.email'))).toBeDisabled();
    await act(async () => call.resolve());
    expect(
      await screen.findByRole('heading', { name: en.screens.settings, level: 1 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('offers the one tap dev login', async () => {
    renderRoute('/login', { auth: 'signedOut' });
    await userEvent.click(await screen.findByRole('button', { name: en.dev.signIn }));
    expect(
      await screen.findByRole('heading', { name: en.screens.today, level: 1 }),
    ).toBeInTheDocument();
  });
});

describe('closed sign up', () => {
  afterEach(() => {
    env.signupOpen = true;
  });

  it('hides the sign up link and sends /signup to the login', async () => {
    env.signupOpen = false;
    const { router } = renderRoute('/signup', { auth: 'signedOut' });
    expect(
      await screen.findByRole('heading', { name: en.screens.login, level: 1 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('link', { name: m.t('login.toSignup') })).toBeNull();
  });
});

describe('sign up', () => {
  async function fill(email: string, password: string) {
    await userEvent.type(await screen.findByLabelText(m.t('fields.email')), email);
    await userEvent.type(field(m.t('fields.password')), password);
    await userEvent.click(screen.getByRole('button', { name: m.t('signup.submit') }));
  }

  it('refuses a weak password before sending', async () => {
    const signUp = vi.fn();
    renderRoute('/signup', { auth: fakeAuth({ signUp }) });
    await fill('a@b.sk', 'short');
    expect(screen.getByText(m.t('errors.weakPassword', { min: 8 }))).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('shows the server refusing a weak password, a taken email and a network error', async () => {
    const signUp = vi
      .fn()
      .mockRejectedValueOnce(new AuthError('weak_password', 'x'))
      .mockRejectedValueOnce(new AuthError('email_taken', 'x'))
      .mockRejectedValueOnce(new AuthError('network', 'x'));
    renderRoute('/signup', { auth: fakeAuth({ signUp }) });
    await fill('a@b.sk', 'password1');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      m.t('errors.weak_password', { min: 8 }),
    );
    const submit = screen.getByRole('button', { name: m.t('signup.submit') });
    await userEvent.click(submit);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(m.t('errors.email_taken')),
    );
    await userEvent.click(submit);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(m.t('errors.network')));
  });

  it('is disabled while sending and then asks for the code', async () => {
    const call = deferred();
    const signUp = vi.fn(() => call.promise);
    const { router } = renderRoute('/signup', { auth: fakeAuth({ signUp }) });
    await fill('new@b.sk', 'password1');
    const submit = screen.getByRole('button', { name: m.t('signup.submit') });
    expect(submit).toBeDisabled();
    await act(async () => call.resolve());
    expect(
      await screen.findByRole('heading', { name: en.screens.verify, level: 1 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/verify');
    expect(readPending()).toMatchObject({ email: 'new@b.sk', purpose: 'signup' });
    expect(screen.getByText(m.t('fields.codeHint', { email: 'new@b.sk' }))).toBeInTheDocument();
  });
});

describe('the code', () => {
  it('without a pending code points back to sign up', async () => {
    renderRoute('/verify', { auth: 'signedOut' });
    expect(await screen.findByText(m.t('verify.noPending'))).toBeInTheDocument();
  });

  it('shows a wrong code, takes a pasted one and signs in', async () => {
    writePending({ email: 'new@b.sk', purpose: 'signup', sentAt: Date.now() });
    server.use(mockEndpoint('profile.get', FRESH_PROFILE));
    renderRoute('/verify', { auth: 'signedOut' });
    const input = await screen.findByLabelText(m.t('fields.code'));
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');

    await userEvent.type(input, '12');
    await userEvent.click(screen.getByRole('button', { name: m.t('verify.submit') }));
    expect(screen.getByText(m.t('errors.codeIncomplete'))).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent(m.t('errors.invalid_code'));

    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste('123 456');
    // Six digits submit by themselves; a fresh account lands on onboarding.
    expect(
      await screen.findByRole('heading', { name: en.screens.onboarding, level: 1 }),
    ).toBeInTheDocument();
    expect(readPending()).toBeNull();
  });

  it('shows a network error from the code check', async () => {
    writePending({ email: 'new@b.sk', purpose: 'signup', sentAt: Date.now() });
    const verifyCode = vi.fn().mockRejectedValue(new AuthError('network', 'x'));
    renderRoute('/verify', { auth: fakeAuth({ verifyCode }) });
    await userEvent.type(await screen.findByLabelText(m.t('fields.code')), '123456');
    expect(await screen.findByRole('alert')).toHaveTextContent(m.t('errors.network'));
    expect(verifyCode).toHaveBeenCalledWith('new@b.sk', '123456', 'signup');
  });

  it('lets a new code be sent only 60 seconds after the last', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const resendCode = vi.fn().mockResolvedValue(undefined);
    writePending({ email: 'new@b.sk', purpose: 'signup', sentAt: Date.now() });
    renderRoute('/verify', { auth: fakeAuth({ resendCode }) });
    const waiting = await screen.findByRole('button', {
      name: m.t('verify.resendIn', { seconds: 60 }),
    });
    expect(waiting).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(
      screen.getByRole('button', { name: m.t('verify.resendIn', { seconds: 30 }) }),
    ).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    const resend = screen.getByRole('button', { name: m.t('verify.resend') });
    expect(resend).toBeEnabled();
    await userEvent.click(resend);
    expect(resendCode).toHaveBeenCalledWith('new@b.sk', 'signup');
    expect(
      await screen.findByRole('button', { name: m.t('verify.resendIn', { seconds: 60 }) }),
    ).toBeDisabled();
  });
});

describe('password reset', () => {
  it('sends a code, refuses a weak password and a wrong code, then sets the password', async () => {
    const auth = fakeAuth();
    const requestPasswordReset = vi.spyOn(auth, 'requestPasswordReset');
    const updatePassword = vi.spyOn(auth, 'updatePassword');
    const { router } = renderRoute('/reset', { auth });
    await userEvent.click(await screen.findByRole('button', { name: m.t('reset.sendCode') }));
    expect(screen.getByText(m.t('errors.emailRequired'))).toBeInTheDocument();
    await userEvent.type(field(m.t('fields.email')), 'me@b.sk');
    await userEvent.click(screen.getByRole('button', { name: m.t('reset.sendCode') }));
    expect(requestPasswordReset).toHaveBeenCalledWith('me@b.sk');

    const code = await screen.findByLabelText(m.t('fields.code'));
    await userEvent.type(code, '999999');
    await userEvent.type(field(m.t('fields.newPassword')), 'short');
    await userEvent.click(screen.getByRole('button', { name: m.t('reset.submit') }));
    expect(screen.getByText(m.t('errors.weakPassword', { min: 8 }))).toBeInTheDocument();

    await userEvent.type(field(m.t('fields.newPassword')), 'enough-now');
    await userEvent.click(screen.getByRole('button', { name: m.t('reset.submit') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.t('errors.invalid_code'));

    await userEvent.clear(code);
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: m.t('reset.submit') }));
    expect(
      await screen.findByRole('heading', { name: en.screens.today, level: 1 }),
    ).toBeInTheDocument();
    expect(updatePassword).toHaveBeenCalledWith('shortenough-now');
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows a network error when asking for the code', async () => {
    const requestPasswordReset = vi.fn().mockRejectedValue(new AuthError('network', 'x'));
    renderRoute('/reset', { auth: fakeAuth({ requestPasswordReset }) });
    await userEvent.type(await screen.findByLabelText(m.t('fields.email')), 'me@b.sk');
    await userEvent.click(screen.getByRole('button', { name: m.t('reset.sendCode') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.t('errors.network'));
  });
});

describe('email links instead of codes', () => {
  /** Supabase's default emails carry a link; the client says so with confirmsByLink. */
  function linkAuth(overrides: Partial<AuthClient> = {}, signedIn = false): AuthClient {
    return { ...createDevAuth({ storage: null, signedIn }), confirmsByLink: true, ...overrides };
  }

  it('asks to open the link after sign up, and resends it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const resendCode = vi.fn().mockResolvedValue(undefined);
    writePending({ email: 'new@b.sk', purpose: 'signup', sentAt: Date.now() - 61_000 });
    renderRoute('/verify', { auth: linkAuth({ resendCode }) });
    expect(
      await screen.findByText(m.t('verify.linkIntro', { email: 'new@b.sk' })),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(m.t('fields.code'))).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: m.t('verify.linkResend') }));
    expect(resendCode).toHaveBeenCalledWith('new@b.sk', 'signup');
  });

  it('goes on once the link signs the learner in', async () => {
    writePending({ email: 'new@b.sk', purpose: 'signup', sentAt: Date.now() });
    server.use(mockEndpoint('profile.get', EXAMPLE_PROFILE));
    const { router } = renderRoute('/verify', { auth: linkAuth({}, true) });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(readPending()).toBeNull();
  });

  it('sends a reset link, then asks only for the new password', async () => {
    const auth = linkAuth();
    const requestPasswordReset = vi.spyOn(auth, 'requestPasswordReset');
    renderRoute('/reset', { auth });
    await userEvent.type(await screen.findByLabelText(m.t('fields.email')), 'me@b.sk');
    await userEvent.click(screen.getByRole('button', { name: m.t('reset.sendCode') }));
    expect(requestPasswordReset).toHaveBeenCalledWith('me@b.sk');
    expect(
      await screen.findByText(m.t('reset.linkSent', { email: 'me@b.sk' })),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(m.t('fields.code'))).toBeNull();
  });

  it('sets the password after the reset link signed the learner in', async () => {
    const auth = linkAuth({}, true);
    const verifyCode = vi.spyOn(auth, 'verifyCode');
    const updatePassword = vi.spyOn(auth, 'updatePassword');
    const { router } = renderRoute('/reset', { auth });
    expect(await screen.findByText(m.t('reset.introLinked'))).toBeInTheDocument();
    await userEvent.type(field(m.t('fields.newPassword')), 'enough-now');
    await userEvent.click(screen.getByRole('button', { name: m.t('reset.submit') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(updatePassword).toHaveBeenCalledWith('enough-now');
    expect(verifyCode).not.toHaveBeenCalled();
  });
});

describe('onboarding', () => {
  function capturePatch() {
    const bodies: UpdateProfile[] = [];
    server.use(
      mockEndpoint('profile.get', FRESH_PROFILE),
      mockEndpoint('profile.update', ({ body }) => {
        bodies.push(body as UpdateProfile);
        return { ...FRESH_PROFILE, ...(body as UpdateProfile) } as Profile;
      }),
    );
    return bodies;
  }

  it('saves name, minutes and time zone, marks the end, and lands on Today', async () => {
    const bodies = capturePatch();
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: en.screens.onboarding, level: 1 }),
    ).toBeInTheDocument();
    const tz = screen.getByLabelText(m.t('onboarding.timezone')) as HTMLInputElement;
    expect(tz.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    await userEvent.type(screen.getByLabelText(m.t('onboarding.name')), 'Zuzka');
    const group = screen.getByRole('radiogroup', { name: m.t('onboarding.minutes') });
    expect(within(group).getByRole('radio', { checked: true })).toHaveTextContent('15 min');
    await userEvent.click(within(group).getByRole('radio', { name: '30 min' }));
    await userEvent.clear(tz);
    await userEvent.type(tz, 'Europe/Bratislava');
    await userEvent.click(screen.getByRole('button', { name: m.t('onboarding.submit') }));

    expect(
      await screen.findByRole('heading', { name: en.screens.today, level: 1 }),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    expect(body).toMatchObject({
      displayName: 'Zuzka',
      timezone: 'Europe/Bratislava',
      dailyNewLimit: 20,
      dailyReviewLimit: 160,
      settings: { minutesPerDay: 30 },
    });
    expect(typeof body?.settings?.onboardedAt).toBe('string');
    // Today on the first run leads to the placement check.
    expect(await screen.findByRole('link', { name: tm.t('today.firstRunAction') })).toHaveAttribute(
      'href',
      '/placement',
    );
  });

  it('refuses an unknown time zone and shows a failed save', async () => {
    capturePatch();
    server.use(mockNetworkError('profile.update'));
    renderRoute('/onboarding');
    const tz = await screen.findByLabelText(m.t('onboarding.timezone'));
    await userEvent.clear(tz);
    await userEvent.type(tz, 'Mars/Olympus');
    const submit = screen.getByRole('button', { name: m.t('onboarding.submit') });
    await userEvent.click(submit);
    expect(screen.getByText(m.t('errors.timezoneInvalid'))).toBeInTheDocument();
    await userEvent.clear(tz);
    await userEvent.type(tz, 'Europe/Vienna');
    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(m.t('errors.network'));
  });

  it('keeps an onboarded learner past the guard', async () => {
    server.use(
      mockEndpoint('profile.get', {
        ...EXAMPLE_PROFILE,
        placementDoneAt: null,
        settings: { onboardedAt: '2026-11-17T08:00:00.000Z' },
      }),
    );
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: en.screens.today, level: 1 }),
    ).toBeInTheDocument();
  });
});
