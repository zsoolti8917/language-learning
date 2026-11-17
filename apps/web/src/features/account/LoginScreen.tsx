// Placeholder from F6. M1 replaces it and keeps the export name.
// In dev mode it offers the one tap login, so the shell can be used before M1 lands.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Placeholder } from '../../app/Placeholder';
import { useAuth } from '../../lib/auth';
import { t } from '../../messages';
import { Button } from '../../ui';

export function LoginScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ strict: false }) as { redirect?: string };
  return (
    <Placeholder title={t('screens.login')}>
      {auth.mode === 'dev' && (
        <Button
          className="mt-6"
          onClick={async () => {
            await auth.signIn('', 'dev');
            await navigate({ to: redirect ?? '/' });
          }}
        >
          {t('dev.signIn')}
        </Button>
      )}
    </Placeholder>
  );
}
