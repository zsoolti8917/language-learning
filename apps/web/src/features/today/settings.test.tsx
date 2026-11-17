import type { Profile, UpdateProfile } from '@app/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_KV_KEY } from '../../lib/auth';
import { kvSet } from '../../lib/db';
import { en } from '../../messages';
import { mockEndpoint, mockError, mockNetworkError, renderRoute, server } from '../../test/utils';
import { appVersion } from './AboutScreen';
import { EXAMPLE_PROFILE } from './fixtures';
import { m } from './messages';
import { parseCap } from './SettingsScreen';
import { THEME_KEY } from './theme';

function capturePatch(start: Profile = EXAMPLE_PROFILE) {
  const bodies: UpdateProfile[] = [];
  let current = start;
  server.use(
    mockEndpoint('profile.get', () => current),
    mockEndpoint('profile.update', ({ body }) => {
      bodies.push(body as UpdateProfile);
      current = { ...current, ...(body as UpdateProfile) } as Profile;
      return current;
    }),
  );
  return bodies;
}

async function openSettings() {
  const r = renderRoute('/settings');
  await screen.findByRole('heading', { name: en.screens.settings, level: 1 });
  await screen.findByText(m.t('settings.limitsTitle'));
  return r;
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe('settings send PATCH /me with only what changed', () => {
  it('daily caps', async () => {
    const bodies = capturePatch();
    await openSettings();
    const save = screen.getByRole('button', { name: m.t('settings.limitsSave') });
    expect(save).toBeDisabled();
    const newCap = screen.getByLabelText(m.t('settings.dailyNew'));
    await userEvent.clear(newCap);
    await userEvent.type(newCap, '1001');
    expect(screen.getByText(m.t('settings.limitRange', { max: 1000 }))).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.clear(newCap);
    await userEvent.type(newCap, '20');
    await userEvent.click(save);
    await waitFor(() => expect(bodies).toEqual([{ dailyNewLimit: 20 }]));
    expect(await screen.findByText(m.t('settings.saved'))).toBeInTheDocument();
  });

  it('strict accents', async () => {
    const bodies = capturePatch();
    await openSettings();
    const toggle = screen.getByRole('switch', { name: m.t('settings.strict') });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(bodies).toEqual([{ strictDiacritics: true }]);
  });

  it('target retention', async () => {
    const bodies = capturePatch();
    await openSettings();
    const group = screen.getByRole('radiogroup', { name: m.t('settings.retention') });
    expect(within(group).getByRole('radio', { checked: true })).toHaveTextContent('90%');
    await userEvent.click(within(group).getByRole('radio', { name: '95%' }));
    await waitFor(() => expect(bodies).toEqual([{ desiredRetention: 0.95 }]));
  });

  it('theme, kept with the other free form settings', async () => {
    const bodies = capturePatch({ ...EXAMPLE_PROFILE, settings: { onboardedAt: 'x' } });
    await openSettings();
    const group = screen.getByRole('radiogroup', { name: m.t('settings.theme') });
    await userEvent.click(within(group).getByRole('radio', { name: m.t('settings.themeDark') }));
    await waitFor(() =>
      expect(bodies).toEqual([{ settings: { onboardedAt: 'x', theme: 'dark' } }]),
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    await userEvent.click(within(group).getByRole('radio', { name: m.t('settings.themeSystem') }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
  });

  it('a failed save says so and keeps the old value', async () => {
    capturePatch();
    server.use(mockError('profile.update', 'validation_failed'));
    await openSettings();
    const toggle = screen.getByRole('switch', { name: m.t('settings.strict') });
    await userEvent.click(toggle);
    expect(await screen.findByText(m.t('settings.saveFailed'))).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

describe('your data', () => {
  it('exports the data as a JSON file', async () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: m.t('settings.export') }));
    expect(await screen.findByText(m.t('settings.exportDone'))).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('signs out to the login', async () => {
    const { router } = await openSettings();
    await userEvent.click(screen.getByRole('button', { name: m.t('settings.signOut') }));
    expect(
      await screen.findByRole('heading', { name: en.screens.login, level: 1 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('deletes the account only after asking twice', async () => {
    let deletes = 0;
    server.use(
      mockEndpoint('profile.delete', () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { context } = await openSettings();
    await userEvent.click(screen.getByRole('button', { name: m.t('settings.delete') }));
    const first = await screen.findByRole('dialog', { name: m.t('settings.deleteTitle') });
    await userEvent.click(
      within(first).getByRole('button', { name: m.t('settings.deleteCancel') }),
    );
    // vaul keeps the content mounted for its exit animation, marked closed.
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull(),
    );
    expect(deletes).toBe(0);

    await userEvent.click(
      screen.getByRole('button', { name: m.t('settings.delete'), hidden: true }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: m.t('settings.deleteContinue'),
      }),
    );
    const second = await screen.findByRole('dialog', { name: m.t('settings.deleteConfirmTitle') });
    expect(deletes).toBe(0);
    await userEvent.click(
      within(second).getByRole('button', { name: m.t('settings.deleteConfirm') }),
    );
    expect(
      await screen.findByRole('heading', { name: en.screens.login, level: 1 }),
    ).toBeInTheDocument();
    expect(deletes).toBe(1);
    expect(context.auth.session).toBeNull();
  });

  it('keeps the learner signed in when the deletion fails', async () => {
    server.use(mockNetworkError('profile.delete'));
    const { context } = await openSettings();
    await userEvent.click(screen.getByRole('button', { name: m.t('settings.delete') }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: m.t('settings.deleteContinue'),
      }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: m.t('settings.deleteConfirm'),
      }),
    );
    expect(await screen.findByText(m.t('settings.deleteFailed'))).toBeInTheDocument();
    expect(context.auth.session).not.toBeNull();
  });
});

describe('settings states', () => {
  it('shows an error with a retry when the profile does not load', async () => {
    // Offline with a stored profile: the guard lets the learner in, the screen's read fails.
    await kvSet(PROFILE_KV_KEY, EXAMPLE_PROFILE);
    server.use(mockNetworkError('profile.get'));
    renderRoute('/settings');
    expect(await screen.findByText(m.t('settings.loadFailed'))).toBeInTheDocument();
    server.use(mockEndpoint('profile.get', EXAMPLE_PROFILE));
    await userEvent.click(screen.getByRole('button', { name: m.t('settings.retry') }));
    expect(await screen.findByText(m.t('settings.limitsTitle'))).toBeInTheDocument();
  });

  it('disables changes offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await openSettings();
    expect(screen.getByText(m.t('settings.offline'))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: m.t('settings.strict') })).toBeDisabled();
    expect(screen.getByRole('button', { name: m.t('settings.delete') })).toBeDisabled();
  });
});

describe('about', () => {
  it('shows versions and the sources', async () => {
    renderRoute('/settings/about');
    expect(
      await screen.findByRole('heading', { name: en.screens.about, level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('2026-11-17.1')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('Tatoeba')).toBeInTheDocument();
    expect(screen.getByText('SNK morphological database')).toBeInTheDocument();
  });

  it('says when content is missing or the server is unreachable', async () => {
    server.use(mockEndpoint('system.health', { ok: true, version: '0.2.0', contentVersion: null }));
    renderRoute('/settings/about');
    expect(await screen.findByText(m.t('about.contentMissing'))).toBeInTheDocument();
  });

  it('reads the app version from the build', () => {
    expect(appVersion({ VITE_APP_VERSION: '1.2.3' })).toBe('1.2.3');
    expect(appVersion({})).toBeNull();
    expect(parseCap('12', 20)).toBe(12);
    expect(parseCap('21', 20)).toBeUndefined();
    expect(parseCap('1.5', 20)).toBeUndefined();
    expect(parseCap('', 20)).toBeUndefined();
  });
});
