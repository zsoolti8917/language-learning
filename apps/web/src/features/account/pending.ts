// The code the learner waits for: which email, why, and when it was sent. Kept in
// sessionStorage so a reload of the code screen keeps it; the route table has no search
// params for /verify, so the screens hand it over here.
import type { CodePurpose } from '../../lib/auth';

export interface PendingCode {
  email: string;
  purpose: CodePurpose;
  /** Epoch ms when the code was last sent. */
  sentAt: number;
}

const KEY = 'app.pendingCode';
/** A new code may be requested this long after the last one. */
export const RESEND_WAIT_SECONDS = 60;

let memory: PendingCode | null = null;

export function readPending(): PendingCode | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingCode) : null;
  } catch {
    // Blocked storage: the copy in memory lasts for this page.
    return memory;
  }
}

export function writePending(p: PendingCode | null): void {
  memory = p;
  try {
    if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Memory only.
  }
}

/** Whole seconds until a new code may be sent; 0 when it may. */
export function secondsUntilResend(sentAt: number, now: number): number {
  return Math.max(0, Math.ceil((sentAt + RESEND_WAIT_SECONDS * 1000 - now) / 1000));
}
