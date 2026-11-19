// /login: email and password, links to sign up and reset, and the one tap dev login.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { env } from '../../lib/env';
import { t } from '../../messages';
import { Button, Input } from '../../ui';
import { m } from './messages';
import { AuthScreen, FormError, TextLink } from './parts';
import { authErrorMessage, emailError, passwordError } from './validation';

export function LoginScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ strict: false }) as { redirect?: string };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string>();

  const errors = { email: emailError(email), password: passwordError(password) };
  const shown: Partial<typeof errors> = touched ? errors : {};

  const done = () => navigate({ to: redirect ?? '/' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setFormError(undefined);
    if (errors.email || errors.password) return;
    setSending(true);
    try {
      await auth.signIn(email.trim(), password);
      await done();
    } catch (err) {
      setFormError(authErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthScreen
      title={t('screens.login')}
      intro={m.t('login.intro')}
      footer={
        <>
          <TextLink to="/reset">{m.t('login.forgot')}</TextLink>
          {env.signupOpen && (
            <p className="text-fg-muted">
              {m.t('login.noAccount')} <TextLink to="/signup">{m.t('login.toSignup')}</TextLink>
            </p>
          )}
        </>
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
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={shown.password}
          disabled={sending}
        />
        <FormError>{formError}</FormError>
        <Button type="submit" block size="lg" loading={sending}>
          {m.t('login.submit')}
        </Button>
      </form>
      {auth.mode === 'dev' && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm text-fg-muted">{m.t('login.devHint')}</p>
          <Button
            variant="secondary"
            block
            disabled={sending}
            onClick={async () => {
              setSending(true);
              try {
                await auth.signIn('', 'dev');
                await done();
              } catch (err) {
                setFormError(authErrorMessage(err));
              } finally {
                setSending(false);
              }
            }}
          >
            {t('dev.signIn')}
          </Button>
        </div>
      )}
    </AuthScreen>
  );
}
