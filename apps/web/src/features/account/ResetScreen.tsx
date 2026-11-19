// /reset: email → six digit code and a new password. The code signs the learner in
// (`verifyCode(…, 'recovery')`), then `updatePassword` sets the new one. When the email
// carries a link instead (Supabase's default emails), the link returns here signed in and
// only the new password is asked for.
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { t } from '../../messages';
import { Button, Input, useToast } from '../../ui';
import { CodeField, ResendButton } from './code';
import { m } from './messages';
import { AuthScreen, FormError, TextLink } from './parts';
import { type PendingCode, readPending, writePending } from './pending';
import {
  authErrorMessage,
  codeError,
  emailError,
  MIN_PASSWORD,
  newPasswordError,
} from './validation';

function pendingRecovery(): PendingCode | null {
  const p = readPending();
  return p?.purpose === 'recovery' ? p : null;
}

export function ResetScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [pending, setPending] = useState<PendingCode | null>(pendingRecovery);
  const [email, setEmail] = useState(() => pendingRecovery()?.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  /** The code was accepted; only the password is left (after a weak password, say). */
  const [verified, setVerified] = useState(false);
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string>();
  /** Signed in by the email link: the code step is done. */
  const linkedIn = auth.confirmsByLink && auth.session !== null;

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setFormError(undefined);
    if (emailError(email)) return;
    setSending(true);
    try {
      const address = email.trim();
      await auth.requestPasswordReset(address);
      const next: PendingCode = { email: address, purpose: 'recovery', sentAt: Date.now() };
      writePending(next);
      setPending(next);
      setTouched(false);
    } catch (err) {
      setFormError(authErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function setNewPassword(e: FormEvent) {
    e.preventDefault();
    if (!pending && !linkedIn) return;
    setTouched(true);
    setFormError(undefined);
    if ((!verified && !linkedIn && codeError(code)) || newPasswordError(password)) return;
    setSending(true);
    try {
      if (!verified && !linkedIn) {
        await auth.verifyCode(pending?.email ?? '', code, 'recovery');
        setVerified(true);
      }
      await auth.updatePassword(password);
      writePending(null);
      toast({ title: m.t('reset.done'), tone: 'success' });
      await navigate({ to: '/' });
    } catch (err) {
      setFormError(authErrorMessage(err));
      setSending(false);
    }
  }

  async function resend() {
    if (!pending) return;
    setFormError(undefined);
    try {
      await auth.resendCode(pending.email, 'recovery');
      const next = { ...pending, sentAt: Date.now() };
      writePending(next);
      setPending(next);
      toast({ title: m.t('verify.resent'), tone: 'success' });
    } catch (err) {
      setFormError(authErrorMessage(err));
    }
  }

  const footer = <TextLink to="/login">{m.t('reset.toLogin')}</TextLink>;

  if (linkedIn) {
    return (
      <AuthScreen title={t('screens.reset')} intro={m.t('reset.introLinked')} footer={footer}>
        <form noValidate onSubmit={setNewPassword} className="flex flex-col gap-4">
          <Input
            label={m.t('fields.newPassword')}
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={m.t('fields.passwordHint', { min: MIN_PASSWORD })}
            error={touched ? newPasswordError(password) : undefined}
            disabled={sending}
          />
          <FormError>{formError}</FormError>
          <Button type="submit" block size="lg" loading={sending}>
            {m.t('reset.submit')}
          </Button>
        </form>
      </AuthScreen>
    );
  }

  if (!pending) {
    const error = touched ? emailError(email) : undefined;
    return (
      <AuthScreen title={t('screens.reset')} intro={m.t('reset.introEmail')} footer={footer}>
        <form noValidate onSubmit={sendCode} className="flex flex-col gap-4">
          <Input
            label={m.t('fields.email')}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            disabled={sending}
          />
          <FormError>{formError}</FormError>
          <Button type="submit" block size="lg" loading={sending}>
            {m.t('reset.sendCode')}
          </Button>
        </form>
      </AuthScreen>
    );
  }

  if (auth.confirmsByLink) {
    return (
      <AuthScreen
        title={t('screens.reset')}
        intro={m.t('reset.linkSent', { email: pending.email })}
        footer={footer}
      >
        <div className="flex flex-col gap-4">
          <FormError>{formError}</FormError>
          <ResendButton link sentAt={pending.sentAt} onResend={resend} />
          <Button
            variant="ghost"
            block
            onClick={() => {
              writePending(null);
              setPending(null);
              setFormError(undefined);
            }}
          >
            {m.t('reset.otherEmail')}
          </Button>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t('screens.reset')} intro={m.t('reset.introCode')} footer={footer}>
      <form noValidate onSubmit={setNewPassword} className="flex flex-col gap-4">
        {!verified && (
          <CodeField
            value={code}
            onChange={(c) => {
              setCode(c);
              setFormError(undefined);
            }}
            hint={m.t('fields.codeHint', { email: pending.email })}
            error={touched ? codeError(code) : undefined}
            disabled={sending}
          />
        )}
        <Input
          label={m.t('fields.newPassword')}
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={m.t('fields.passwordHint', { min: MIN_PASSWORD })}
          error={touched ? newPasswordError(password) : undefined}
          disabled={sending}
        />
        <FormError>{formError}</FormError>
        <Button type="submit" block size="lg" loading={sending}>
          {m.t('reset.submit')}
        </Button>
        {!verified && <ResendButton sentAt={pending.sentAt} onResend={resend} disabled={sending} />}
        <Button
          variant="ghost"
          block
          disabled={sending}
          onClick={() => {
            writePending(null);
            setPending(null);
            setVerified(false);
            setCode('');
            setTouched(false);
            setFormError(undefined);
          }}
        >
          {m.t('reset.otherEmail')}
        </Button>
      </form>
    </AuthScreen>
  );
}
