// /settings: daily caps, strict accents, target retention, theme, export, sign out and an
// account deletion that asks twice. Every change sends `PATCH /me` with only what changed.
import type { Profile, UpdateProfile } from '@app/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useOnline } from '../../lib/pwa';
import { t } from '../../messages';
import { Button, Card, EmptyState, Input, Sheet, Skeleton, useToast } from '../../ui';
import { ChoiceGroup } from '../account/parts';
import { useProfile, useUpdateProfile, withSetting } from '../account/profile';
import { AppNotices } from './AppNotices';
import { m } from './messages';
import { applyTheme, THEMES, type Theme, themeOf, useProfileTheme } from './theme';

const RETENTIONS = [0.8, 0.85, 0.9, 0.95] as const;
const MAX_NEW = 1000;
const MAX_REVIEW = 10000;

/** A whole number in 0..max from a field, or undefined. */
export function parseCap(raw: string, max: number): number | undefined {
  if (!/^\d+$/.test(raw.trim())) return undefined;
  const n = Number(raw.trim());
  return n <= max ? n : undefined;
}

export function SettingsScreen() {
  const profile = useProfile();
  useProfileTheme(profile.data);
  return (
    <section className="flex flex-col gap-4 px-gutter py-6">
      <header className="flex flex-col gap-1">
        <Link
          to="/"
          className="inline-flex min-h-tap items-center self-start font-medium text-primary underline"
        >
          {m.t('settings.back')}
        </Link>
        <h1 className="text-2xl font-semibold text-fg">{t('screens.settings')}</h1>
      </header>
      <AppNotices />
      {profile.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton height="10rem" />
          <Skeleton height="5rem" />
          <Skeleton height="5rem" />
        </div>
      ) : profile.isError ? (
        <EmptyState
          title={m.t('settings.loadFailed')}
          action={<Button onClick={() => void profile.refetch()}>{m.t('settings.retry')}</Button>}
        />
      ) : (
        <SettingsForm profile={profile.data} />
      )}
    </section>
  );
}

function SettingsForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const online = useOnline();
  const toast = useToast();
  const offline = !online;

  async function save(body: UpdateProfile): Promise<boolean> {
    try {
      await update.mutateAsync(body);
      toast({ title: m.t('settings.saved'), tone: 'success', duration: 2000 });
      return true;
    } catch {
      toast({ title: m.t('settings.saveFailed'), tone: 'error' });
      return false;
    }
  }

  const busy = update.isPending || offline;
  const retentions = RETENTIONS.includes(profile.desiredRetention as (typeof RETENTIONS)[number])
    ? RETENTIONS
    : [...RETENTIONS, profile.desiredRetention].sort();

  return (
    <div className="flex flex-col gap-4">
      {offline && (
        <p role="status" className="text-sm text-fg-muted">
          {m.t('settings.offline')}
        </p>
      )}
      <LimitsCard profile={profile} disabled={busy} onSave={save} />

      <Card title={m.t('settings.answersTitle')}>
        <div className="flex items-center justify-between gap-3">
          <span id="strict-label" className="text-base font-medium text-fg">
            {m.t('settings.strict')}
          </span>
          <Button
            role="switch"
            aria-checked={profile.strictDiacritics}
            aria-labelledby="strict-label"
            aria-describedby="strict-hint"
            variant={profile.strictDiacritics ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => void save({ strictDiacritics: !profile.strictDiacritics })}
          >
            {profile.strictDiacritics ? m.t('settings.switchOn') : m.t('settings.switchOff')}
          </Button>
        </div>
        <p id="strict-hint" className="mt-2 text-sm text-fg-muted">
          {profile.strictDiacritics ? m.t('settings.strictOn') : m.t('settings.strictOff')}
        </p>
      </Card>

      <Card title={m.t('settings.memoryTitle')}>
        <ChoiceGroup
          label={m.t('settings.retention')}
          hint={m.t('settings.retentionHint')}
          options={retentions.map((r) => ({
            value: r,
            label: m.t('settings.retentionOption', { percent: Math.round(r * 100) }),
          }))}
          value={profile.desiredRetention}
          disabled={busy}
          onChange={(r) => {
            if (r !== profile.desiredRetention) void save({ desiredRetention: r });
          }}
        />
      </Card>

      <Card title={m.t('settings.appearanceTitle')}>
        <ChoiceGroup<Theme>
          label={m.t('settings.theme')}
          options={THEMES.map((v) => ({
            value: v,
            label: m.t(
              v === 'system'
                ? 'settings.themeSystem'
                : v === 'light'
                  ? 'settings.themeLight'
                  : 'settings.themeDark',
            ),
          }))}
          value={themeOf(profile)}
          disabled={busy}
          onChange={(theme) => {
            if (theme === themeOf(profile)) return;
            applyTheme(theme);
            void save({ settings: withSetting(profile, 'theme', theme) }).then((ok) => {
              if (!ok) applyTheme(themeOf(profile));
            });
          }}
        />
      </Card>

      <DataCard offline={offline} />

      <Button asChild variant="ghost" block>
        <Link to="/settings/about">{m.t('settings.about')}</Link>
      </Button>
    </div>
  );
}

function LimitsCard({
  profile,
  disabled,
  onSave,
}: {
  profile: Profile;
  disabled: boolean;
  onSave: (body: UpdateProfile) => Promise<boolean>;
}) {
  const [newCap, setNewCap] = useState(String(profile.dailyNewLimit));
  const [reviewCap, setReviewCap] = useState(String(profile.dailyReviewLimit));
  const [saving, setSaving] = useState(false);
  const newValue = parseCap(newCap, MAX_NEW);
  const reviewValue = parseCap(reviewCap, MAX_REVIEW);
  const body: UpdateProfile = {};
  if (newValue !== undefined && newValue !== profile.dailyNewLimit) body.dailyNewLimit = newValue;
  if (reviewValue !== undefined && reviewValue !== profile.dailyReviewLimit)
    body.dailyReviewLimit = reviewValue;
  const invalid = newValue === undefined || reviewValue === undefined;
  const changed = Object.keys(body).length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid || !changed) return;
    setSaving(true);
    await onSave(body);
    setSaving(false);
  }

  return (
    <Card title={m.t('settings.limitsTitle')} subtitle={m.t('settings.limitsHint')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={m.t('settings.dailyNew')}
            name="dailyNewLimit"
            inputMode="numeric"
            value={newCap}
            onChange={(e) => setNewCap(e.target.value)}
            error={
              newValue === undefined ? m.t('settings.limitRange', { max: MAX_NEW }) : undefined
            }
            disabled={disabled}
          />
          <Input
            label={m.t('settings.dailyReview')}
            name="dailyReviewLimit"
            inputMode="numeric"
            value={reviewCap}
            onChange={(e) => setReviewCap(e.target.value)}
            error={
              reviewValue === undefined
                ? m.t('settings.limitRange', { max: MAX_REVIEW })
                : undefined
            }
            disabled={disabled}
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          disabled={disabled || invalid || !changed}
          loading={saving}
        >
          {m.t('settings.limitsSave')}
        </Button>
      </form>
    </Card>
  );
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DataCard({ offline }: { offline: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  async function exportData() {
    setExporting(true);
    try {
      const data = await api.profile.export();
      downloadJson(data, `slovak-export-${new Date().toISOString().slice(0, 10)}.json`);
      toast({ title: m.t('settings.exportDone'), tone: 'success' });
    } catch {
      toast({ title: m.t('settings.exportFailed'), tone: 'error' });
    } finally {
      setExporting(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await auth.signOut();
    } finally {
      setSigningOut(false);
    }
    await navigate({ to: '/login' });
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await api.profile.delete();
    } catch {
      setDeleteError(m.t('settings.deleteFailed'));
      setDeleting(false);
      return;
    }
    setDeleteStep(0);
    await auth.signOut();
    await navigate({ to: '/login' });
  }

  return (
    <Card title={m.t('settings.dataTitle')}>
      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          block
          loading={exporting}
          disabled={offline}
          onClick={exportData}
        >
          {m.t('settings.export')}
        </Button>
        <Button variant="secondary" block loading={signingOut} onClick={signOut}>
          {m.t('settings.signOut')}
        </Button>
        <Button
          variant="danger"
          block
          disabled={offline}
          onClick={() => {
            setDeleteError(undefined);
            setDeleteStep(1);
          }}
        >
          {m.t('settings.delete')}
        </Button>
      </div>
      <Sheet
        open={deleteStep > 0}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteStep(0);
        }}
        title={deleteStep === 2 ? m.t('settings.deleteConfirmTitle') : m.t('settings.deleteTitle')}
        description={
          deleteStep === 2 ? m.t('settings.deleteConfirmBody') : m.t('settings.deleteBody')
        }
        footer={
          <div className="flex flex-col gap-2">
            {deleteError && (
              <p role="alert" className="text-sm font-medium text-wrong">
                {deleteError}
              </p>
            )}
            {deleteStep === 2 ? (
              <Button variant="danger" block loading={deleting} onClick={deleteAccount}>
                {m.t('settings.deleteConfirm')}
              </Button>
            ) : (
              <Button variant="danger" block onClick={() => setDeleteStep(2)}>
                {m.t('settings.deleteContinue')}
              </Button>
            )}
            <Button variant="ghost" block disabled={deleting} onClick={() => setDeleteStep(0)}>
              {m.t('settings.deleteCancel')}
            </Button>
          </div>
        }
      />
    </Card>
  );
}
