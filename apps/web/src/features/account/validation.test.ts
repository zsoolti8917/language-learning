import { describe, expect, it } from 'vitest';
import { AuthError } from '../../lib/auth';
import { m } from './messages';
import { RESEND_WAIT_SECONDS, readPending, secondsUntilResend, writePending } from './pending';
import {
  authErrorMessage,
  codeError,
  detectTimeZone,
  emailError,
  isValidTimeZone,
  MINUTE_PRESETS,
  newPasswordError,
  normalizeCode,
  passwordError,
  presetFor,
} from './validation';

describe('account validation', () => {
  it('checks emails', () => {
    expect(emailError('')).toBe(m.t('errors.emailRequired'));
    expect(emailError('nope')).toBe(m.t('errors.emailInvalid'));
    expect(emailError(' a@b.sk ')).toBeUndefined();
  });

  it('wants passwords of at least 8 characters for new ones, any for sign in', () => {
    expect(newPasswordError('1234567')).toBe(m.t('errors.weakPassword', { min: 8 }));
    expect(newPasswordError('12345678')).toBeUndefined();
    expect(passwordError('')).toBe(m.t('errors.passwordRequired'));
    expect(passwordError('x')).toBeUndefined();
  });

  it('keeps six digits of a typed or pasted code', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('12-34-56-78')).toBe('123456');
    expect(normalizeCode('ab1')).toBe('1');
    expect(codeError('12345')).toBe(m.t('errors.codeIncomplete'));
    expect(codeError('123456')).toBeUndefined();
  });

  it('maps every login error code to a message', () => {
    for (const code of [
      'invalid_credentials',
      'invalid_code',
      'email_taken',
      'rate_limited',
      'network',
      'unknown',
    ] as const) {
      expect(authErrorMessage(new AuthError(code, 'x'))).toBe(m.t(`errors.${code}`));
    }
    expect(authErrorMessage(new AuthError('weak_password', 'x'))).toContain('8');
    expect(authErrorMessage(new Error('boom'))).toBe(m.t('errors.unknown'));
  });

  it('knows time zones', () => {
    expect(isValidTimeZone('Europe/Bratislava')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(detectTimeZone())).toBe(true);
  });

  it('finds the preset of the profile caps; 15 minutes are the profile defaults', () => {
    expect(presetFor({ dailyNewLimit: 10, dailyReviewLimit: 80 })?.minutes).toBe(15);
    expect(presetFor({ dailyNewLimit: 11, dailyReviewLimit: 80 })).toBeUndefined();
    const minutes = MINUTE_PRESETS.map((p) => p.minutes);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });
});

describe('pending code', () => {
  it('waits 60 seconds before a new code', () => {
    expect(RESEND_WAIT_SECONDS).toBe(60);
    expect(secondsUntilResend(1_000, 1_000)).toBe(60);
    expect(secondsUntilResend(1_000, 1_500)).toBe(60);
    expect(secondsUntilResend(1_000, 31_000)).toBe(30);
    expect(secondsUntilResend(1_000, 61_000)).toBe(0);
    expect(secondsUntilResend(1_000, 99_000)).toBe(0);
  });

  it('survives in sessionStorage', () => {
    writePending({ email: 'a@b.sk', purpose: 'signup', sentAt: 5 });
    expect(readPending()).toEqual({ email: 'a@b.sk', purpose: 'signup', sentAt: 5 });
    writePending(null);
    expect(readPending()).toBeNull();
  });
});
