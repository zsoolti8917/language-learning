// Form checks of the account screens. Pure, so they are tested without rendering.
import { AuthError } from '../../lib/auth';
import { m } from './messages';

/** Supabase's default minimum, and the dev login's (`DEV_MIN_PASSWORD`). */
export const MIN_PASSWORD = 8;
export const CODE_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(email: string): string | undefined {
  const v = email.trim();
  if (!v) return m.t('errors.emailRequired');
  if (!EMAIL_RE.test(v)) return m.t('errors.emailInvalid');
  return undefined;
}

/** For a new password: long enough. */
export function newPasswordError(password: string): string | undefined {
  if (password.length < MIN_PASSWORD) return m.t('errors.weakPassword', { min: MIN_PASSWORD });
  return undefined;
}

/** For signing in: present. */
export function passwordError(password: string): string | undefined {
  return password ? undefined : m.t('errors.passwordRequired');
}

/** Keeps the digits of typed or pasted text ("123 456", "123-456"), at most six. */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function codeError(code: string): string | undefined {
  return code.length === CODE_LENGTH ? undefined : m.t('errors.codeIncomplete');
}

/** The message for a failed login call. */
export function authErrorMessage(e: unknown): string {
  if (e instanceof AuthError) {
    if (e.code === 'weak_password') return m.t('errors.weak_password', { min: MIN_PASSWORD });
    return m.t(`errors.${e.code}`);
  }
  return m.t('errors.unknown');
}

/** True when the browser knows the IANA time zone name. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/** The device's time zone, or the profile default when the browser does not say. */
export function detectTimeZone(fallback = 'Europe/Bratislava'): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : fallback;
  } catch {
    return fallback;
  }
}

/** Minutes per day as a preset for the daily caps. */
export const MINUTE_PRESETS = [
  { minutes: 5, dailyNewLimit: 3, dailyReviewLimit: 30 },
  { minutes: 10, dailyNewLimit: 5, dailyReviewLimit: 50 },
  { minutes: 15, dailyNewLimit: 10, dailyReviewLimit: 80 },
  { minutes: 30, dailyNewLimit: 20, dailyReviewLimit: 160 },
  { minutes: 60, dailyNewLimit: 40, dailyReviewLimit: 320 },
] as const;
export type MinutePreset = (typeof MINUTE_PRESETS)[number];
/** 15 minutes equals the profile defaults (10 new, 80 reviews). */
export const DEFAULT_MINUTES = 15;

/** The preset whose caps match the profile, if any. */
export function presetFor(caps: { dailyNewLimit: number; dailyReviewLimit: number }) {
  return MINUTE_PRESETS.find(
    (p) => p.dailyNewLimit === caps.dailyNewLimit && p.dailyReviewLimit === caps.dailyReviewLimit,
  );
}
