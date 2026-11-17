// /verify: the six digit code that confirms a new account. On success the learner is signed
// in and goes to Today; the route guard sends a first run to onboarding.
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { DEV_CODE, useAuth } from '../../lib/auth';
import { t } from '../../messages';
import { Button, EmptyState, useToast } from '../../ui';
import { CodeField, ResendButton } from './code';
import { m } from './messages';
import { AuthScreen, FormError, TextLink } from './parts';
import { type PendingCode, readPending, writePending } from './pending';
import { authErrorMessage, codeError } from './validation';

export function VerifyScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [pending, setPending] = useState<PendingCode | null>(readPending);
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string>();

  if (!pending) {
    return (
      <AuthScreen title={t('screens.verify')}>
        <EmptyState
          title={m.t('verify.noPending')}
          description={m.t('verify.noPendingHint')}
          action={
            <div className="flex flex-col items-center">
              <TextLink to="/signup">{m.t('verify.toSignup')}</TextLink>
              <TextLink to="/login">{m.t('verify.toLogin')}</TextLink>
            </div>
          }
        />
      </AuthScreen>
    );
  }
  const current = pending;

  async function confirm(value: string) {
    setTouched(true);
    setFormError(undefined);
    if (codeError(value) || sending) return;
    setSending(true);
    try {
      await auth.verifyCode(current.email, value, current.purpose);
      writePending(null);
      await navigate({ to: '/' });
    } catch (err) {
      setFormError(authErrorMessage(err));
      setSending(false);
    }
  }

  async function resend() {
    setFormError(undefined);
    try {
      await auth.resendCode(current.email, current.purpose);
      const next = { ...current, sentAt: Date.now() };
      writePending(next);
      setPending(next);
      setCode('');
      setTouched(false);
      toast({ title: m.t('verify.resent'), tone: 'success' });
    } catch (err) {
      setFormError(authErrorMessage(err));
    }
  }

  return (
    <AuthScreen
      title={t('screens.verify')}
      intro={m.t('verify.intro')}
      footer={<TextLink to="/login">{m.t('verify.toLogin')}</TextLink>}
    >
      <form
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void confirm(code);
        }}
        className="flex flex-col gap-4"
      >
        <CodeField
          value={code}
          onChange={(c) => {
            setCode(c);
            setFormError(undefined);
          }}
          onComplete={(c) => void confirm(c)}
          hint={m.t('fields.codeHint', { email: current.email })}
          error={touched ? codeError(code) : undefined}
          disabled={sending}
        />
        {auth.mode === 'dev' && (
          <p className="text-sm text-fg-muted">{m.t('verify.devHint', { code: DEV_CODE })}</p>
        )}
        <FormError>{formError}</FormError>
        <Button type="submit" block size="lg" loading={sending}>
          {m.t('verify.submit')}
        </Button>
        <ResendButton sentAt={current.sentAt} onResend={resend} disabled={sending} />
      </form>
    </AuthScreen>
  );
}
