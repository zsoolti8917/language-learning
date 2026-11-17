// /onboarding: the first run. Name, minutes per day (a preset for the daily caps) and the
// detected time zone. Ends with `PATCH /me` that sets `settings.onboardedAt`, which is what the
// route guard checks (lib/auth `isFirstRun`); Today then leads to the placement check.
import type { Profile } from '@app/contracts';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { isApiError } from '../../lib/api';
import { t } from '../../messages';
import { Button, EmptyState, Input, Skeleton } from '../../ui';
import { m } from './messages';
import { AuthScreen, ChoiceGroup, FormError } from './parts';
import { useProfile, useUpdateProfile, withSetting } from './profile';
import {
  DEFAULT_MINUTES,
  detectTimeZone,
  isValidTimeZone,
  MINUTE_PRESETS,
  presetFor,
} from './validation';

export function OnboardingScreen() {
  const profile = useProfile();
  if (profile.isPending) {
    return (
      <AuthScreen title={t('screens.onboarding')}>
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton height="4.5rem" />
          <Skeleton height="4.5rem" />
          <Skeleton height="4.5rem" />
        </div>
      </AuthScreen>
    );
  }
  if (profile.isError) {
    return (
      <AuthScreen title={t('screens.onboarding')}>
        <EmptyState
          title={m.t('errors.loadFailed')}
          description={
            isApiError(profile.error) && profile.error.isNetwork ? m.t('errors.network') : undefined
          }
          action={<Button onClick={() => void profile.refetch()}>{m.t('common.retry')}</Button>}
        />
      </AuthScreen>
    );
  }
  return <OnboardingForm profile={profile.data} />;
}

function OnboardingForm({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.displayName ?? '');
  const [minutes, setMinutes] = useState<number>(
    (typeof profile.settings?.minutesPerDay === 'number'
      ? profile.settings.minutesPerDay
      : presetFor(profile)?.minutes) ?? DEFAULT_MINUTES,
  );
  const [timezone, setTimezone] = useState(() => detectTimeZone(profile.timezone));
  const [touched, setTouched] = useState(false);

  const preset = MINUTE_PRESETS.find((p) => p.minutes === minutes) ?? MINUTE_PRESETS[2];
  const errors = {
    name: name.trim().length > 100 ? m.t('errors.nameTooLong') : undefined,
    timezone: isValidTimeZone(timezone) ? undefined : m.t('errors.timezoneInvalid'),
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (errors.name || errors.timezone || update.isPending) return;
    try {
      await update.mutateAsync({
        displayName: name.trim() || null,
        timezone: timezone.trim(),
        dailyNewLimit: preset.dailyNewLimit,
        dailyReviewLimit: preset.dailyReviewLimit,
        settings: {
          ...withSetting(profile, 'minutesPerDay', preset.minutes),
          onboardedAt: new Date().toISOString(),
        },
      });
      await navigate({ to: '/' });
    } catch {
      // The error shows under the form.
    }
  }

  const saveError = update.isError
    ? isApiError(update.error) && update.error.isNetwork
      ? m.t('errors.network')
      : m.t('errors.saveFailed')
    : undefined;

  return (
    <AuthScreen title={t('screens.onboarding')} intro={m.t('onboarding.intro')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6">
        <Input
          label={m.t('onboarding.name')}
          name="name"
          autoComplete="given-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint={m.t('onboarding.nameHint')}
          error={touched ? errors.name : undefined}
          disabled={update.isPending}
        />
        <ChoiceGroup
          label={m.t('onboarding.minutes')}
          options={MINUTE_PRESETS.map((p) => ({
            value: p.minutes,
            label: m.t('onboarding.minutesOption', { minutes: p.minutes }),
          }))}
          value={minutes}
          onChange={setMinutes}
          disabled={update.isPending}
          hint={
            <>
              {m.t('onboarding.minutesDetail', {
                newCards: preset.dailyNewLimit,
                reviews: preset.dailyReviewLimit,
              })}{' '}
              {m.t('onboarding.minutesHint')}
            </>
          }
        />
        <Input
          label={m.t('onboarding.timezone')}
          name="timezone"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          hint={m.t('onboarding.timezoneHint')}
          error={touched ? errors.timezone : undefined}
          disabled={update.isPending}
        />
        <FormError>{saveError}</FormError>
        <Button type="submit" block size="lg" loading={update.isPending}>
          {m.t('onboarding.submit')}
        </Button>
      </form>
    </AuthScreen>
  );
}
