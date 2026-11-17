// /signup: email and a new password. Supabase emails a six digit code; /verify takes it.
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { t } from '../../messages';
import { Button, Input } from '../../ui';
import { m } from './messages';
import { AuthScreen, FormError, TextLink } from './parts';
import { writePending } from './pending';
import { authErrorMessage, emailError, MIN_PASSWORD, newPasswordError } from './validation';

export function SignupScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string>();

  const errors = { email: emailError(email), password: newPasswordError(password) };
  const shown: Partial<typeof errors> = touched ? errors : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setFormError(undefined);
    if (errors.email || errors.password) return;
    setSending(true);
    const address = email.trim();
    try {
      await auth.signUp(address, password);
      writePending({ email: address, purpose: 'signup', sentAt: Date.now() });
      await navigate({ to: '/verify' });
    } catch (err) {
      setFormError(authErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthScreen
      title={t('screens.signup')}
      intro={m.t('signup.intro')}
      footer={
        <p className="text-fg-muted">
          {m.t('signup.haveAccount')} <TextLink to="/login">{m.t('signup.toLogin')}</TextLink>
        </p>
      }
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label={m.t('fields.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={shown.email}
          disabled={sending}
        />
        <Input
          label={m.t('fields.password')}
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={shown.password ? undefined : m.t('fields.passwordHint', { min: MIN_PASSWORD })}
          error={shown.password}
          disabled={sending}
        />
        <FormError>{formError}</FormError>
        <Button type="submit" block size="lg" loading={sending}>
          {m.t('signup.submit')}
        </Button>
      </form>
    </AuthScreen>
  );
}
