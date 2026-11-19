// /verify: the six digit code that confirms a new account. On success the learner is signed
// in and goes to Today; the route guard sends a first run to onboarding. When the email
// carries a link instead (Supabase's default emails), the screen waits for the link, which
// returns here signed in.
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { DEV_CODE, useAuth } from '../../lib/auth';
import { env } from '../../lib/env';
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
  const linkedIn = auth.confirmsByLink && auth.session !== null;

  // The email link came back here signed in: the account is confirmed.
  useEffect(() => {
    if (!linkedIn) return;
    writePending(null);
    void navigate({ to: '/' });
  }, [linkedIn, navigate]);

  if (linkedIn) return null;

  if (!pending) {
    return (
      <AuthScreen title={t('screens.verify')}>
        <EmptyState
          title={m.t('verify.noPending')}
          description={m.t('verify.noPendingHint')}
          action={
            <div className="flex flex-col items-center">
              {env.signupOpen && <TextLink to="/signup">{m.t('verify.toSignup')}</TextLink>}
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
      toast({
        title: m.t(auth.confirmsByLink ? 'verify.linkResent' : 'verify.resent'),
        tone: 'success',
      });
    } catch (err) {
      setFormError(authErrorMessage(err));
    }
  }

  if (auth.confirmsByLink) {
    return (
      <AuthScreen
        title={t('screens.verify')}
        intro={m.t('verify.linkIntro', { email: current.email })}
        footer={<TextLink to="/login">{m.t('verify.toLogin')}</TextLink>}
      >
        <div className="flex flex-col gap-4">
          <FormError>{formError}</FormError>
          <ResendButton link sentAt={current.sentAt} onResend={resend} />
        </div>
      </AuthScreen>
    );
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
