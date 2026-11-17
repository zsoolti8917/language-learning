// The six digit code field and the resend button that waits 60 seconds.
import { useEffect, useState } from 'react';
import { Button, Input } from '../../ui';
import { m } from './messages';
import { secondsUntilResend } from './pending';
import { CODE_LENGTH, normalizeCode } from './validation';

/**
 * One field for the code: digits only, at most six, paste friendly ("123 456" → "123456").
 * iOS offers the code from Mail above the keyboard through `autocomplete="one-time-code"`.
 * Calls `onComplete` when the sixth digit arrives.
 */
export function CodeField({
  value,
  onChange,
  onComplete,
  hint,
  error,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const take = (raw: string) => {
    const code = normalizeCode(raw);
    onChange(code);
    if (code.length === CODE_LENGTH && code !== value) onComplete?.(code);
  };
  return (
    <Input
      label={m.t('fields.code')}
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      autoCapitalize="none"
      spellCheck={false}
      className="[&_input]:text-center [&_input]:font-mono [&_input]:text-answer [&_input]:tracking-[0.4em]"
      value={value}
      onChange={(e) => take(e.target.value)}
      onPaste={(e) => {
        e.preventDefault();
        take(e.clipboardData.getData('text'));
      }}
      hint={hint}
      error={error}
      disabled={disabled}
    />
  );
}

/** Seconds left until `sentAt + 60 s`, ticking once a second. */
export function useResendCountdown(sentAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  const left = secondsUntilResend(sentAt, now);
  useEffect(() => {
    setNow(Date.now());
  }, [sentAt]);
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [left]);
  return left;
}

/** "Send a new code", disabled with a countdown for 60 seconds after each send. */
export function ResendButton({
  sentAt,
  onResend,
  disabled,
}: {
  sentAt: number;
  onResend: () => Promise<void>;
  disabled?: boolean;
}) {
  const left = useResendCountdown(sentAt);
  const [sending, setSending] = useState(false);
  return (
    <Button
      variant="ghost"
      block
      disabled={disabled || left > 0}
      loading={sending}
      onClick={async () => {
        setSending(true);
        try {
          await onResend();
        } finally {
          setSending(false);
        }
      }}
    >
      {left > 0 ? m.t('verify.resendIn', { seconds: left }) : m.t('verify.resend')}
    </Button>
  );
}
