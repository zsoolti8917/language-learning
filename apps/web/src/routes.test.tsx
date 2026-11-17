import { examples, type Profile } from '@app/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { tabFor } from './app/TabBar';
import { PROFILE_KV_KEY } from './lib/auth/profile';
import { kvSet } from './lib/db/db';
import { en } from './messages';
import { ROUTE_PATHS } from './routes';
import { mockEndpoint, mockNetworkError, renderRoute, server } from './test/utils';

const PROFILE = examples['profile.get'].ok[0]?.response.body as Profile;

/** Example URL and expected screen title of every route. */
const ROUTES: { path: string; url: string; title: string; tab: boolean }[] = [
  ['/', '/', en.screens.today],
  ['/settings', '/settings', en.screens.settings],
  ['/settings/about', '/settings/about', en.screens.about],
  ['/review', '/review', en.screens.review],
  ['/deck', '/deck', en.screens.deck],
  ['/deck/$noteId', '/deck/0193a1b2-c3d4-7e5f-8a6b-000000000010', en.screens.note],
  ['/words', '/words', en.screens.words],
  ['/words/band/$band', '/words/band/2', en.screens.band],
  ['/lemma/$lemmaId', '/lemma/20', en.screens.lemma],
  ['/read', '/read', en.screens.library],
  ['/read/import', '/read/import', en.screens.import],
  ['/read/$textId', '/read/0193a1b2-c3d4-7e5f-8a6b-000000000020', en.screens.reader],
  ['/cases', '/cases', en.screens.course],
  ['/cases/lesson/$lessonId', '/cases/lesson/loc-sg', en.screens.lesson],
  ['/cases/train', '/cases/train', en.screens.trainer],
  ['/cases/pattern/$patternId', '/cases/pattern/mesto', en.screens.pattern],
  ['/tutor', '/tutor', en.screens.scenarios],
  ['/tutor/$conversationId', '/tutor/0193a1b2-c3d4-7e5f-8a6b-000000000030', en.screens.chat],
  ['/login', '/login', en.screens.login],
  ['/signup', '/signup', en.screens.signup],
  ['/verify', '/verify', en.screens.verify],
  ['/reset', '/reset', en.screens.reset],
  ['/onboarding', '/onboarding', en.screens.onboarding],
  ['/placement', '/placement', en.screens.placement],
].map(([path, url, title]) => ({
  path: path as string,
  url: url as string,
  title: title as string,
  tab: (ROUTE_PATHS.tabs as readonly string[]).includes(path as string),
}));

describe('route table', () => {
  it('covers every route of the Screens table', () => {
    expect(ROUTES.map((r) => r.path).sort()).toEqual(
      [...ROUTE_PATHS.tabs, ...ROUTE_PATHS.bare].sort(),
    );
    expect(ROUTES).toHaveLength(24);
  });

  it.each(ROUTES.filter((r) => r.tab))(
    '$url shows its placeholder under the tab bar',
    async (r) => {
      // Account screens are for signed out visitors; the rest need a login.
      renderRoute(r.url);
      expect(await screen.findByRole('heading', { name: r.title, level: 1 })).toBeInTheDocument();
      const nav = screen.getByRole('navigation', { name: en.tabs.label });
      const current = within(nav).getByRole('link', { current: 'page' });
      expect(current).toHaveAttribute('data-tab', tabFor(new URL(r.url, 'http://x').pathname));
    },
  );

  it.each(ROUTES.filter((r) => !r.tab))(
    '$url shows its placeholder without a tab bar',
    async (r) => {
      const signedOut = ['/login', '/signup'].includes(r.path);
      renderRoute(r.url, { auth: signedOut ? 'signedOut' : 'signedIn' });
      expect(await screen.findByRole('heading', { name: r.title, level: 1 })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: en.tabs.label })).toBeNull();
    },
  );

  it('passes route params to the screen', async () => {
    // The placeholder printed its params; M5 replaced it, so read them from the router.
    const { router } = renderRoute('/lemma/20');
    expect(await screen.findByRole('heading', { name: en.screens.lemma })).toBeInTheDocument();
    expect(router.state.matches.at(-1)?.params).toEqual({ lemmaId: '20' });
  });

  it('switches tabs from the tab bar', async () => {
    renderRoute('/');
    await screen.findByRole('heading', { name: en.screens.today });
    await userEvent.click(screen.getByRole('link', { name: en.tabs.cases }));
    expect(await screen.findByRole('heading', { name: en.screens.course })).toBeInTheDocument();
  });

  it('shows the not found screen for an unknown path', async () => {
    renderRoute('/nope');
    expect(await screen.findByText(en.app.notFound)).toBeInTheDocument();
  });
});

describe('guards', () => {
  it('sends a signed out visitor to the login and back after signing in', async () => {
    const { router } = renderRoute('/review', { auth: 'signedOut' });
    expect(await screen.findByRole('heading', { name: en.screens.login })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ redirect: '/review' });
    await userEvent.click(screen.getByRole('button', { name: en.dev.signIn }));
    expect(await screen.findByRole('heading', { name: en.screens.review })).toBeInTheDocument();
  });

  it('keeps signed in learners away from the login', async () => {
    renderRoute('/login');
    expect(await screen.findByRole('heading', { name: en.screens.today })).toBeInTheDocument();
  });

  it('sends a learner on the first run to onboarding', async () => {
    server.use(mockEndpoint('profile.get', { ...PROFILE, settings: {}, placementDoneAt: null }));
    renderRoute('/review');
    expect(await screen.findByRole('heading', { name: en.screens.onboarding })).toBeInTheDocument();
  });

  it('lets an onboarded learner without placement into the tabs', async () => {
    server.use(
      mockEndpoint('profile.get', {
        ...PROFILE,
        settings: { onboardedAt: '2026-11-17T08:00:00.000Z' },
        placementDoneAt: null,
      }),
    );
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: en.screens.today })).toBeInTheDocument();
  });

  it('opens offline from the stored profile', async () => {
    await kvSet(PROFILE_KV_KEY, { ...PROFILE, settings: {}, placementDoneAt: null });
    server.use(mockNetworkError('profile.get'));
    renderRoute('/review');
    // The stored profile says first run, so the guard still applies offline.
    expect(await screen.findByRole('heading', { name: en.screens.onboarding })).toBeInTheDocument();
  });

  it('signing out leaves the tabs for the login', async () => {
    const { context } = renderRoute('/deck');
    await screen.findByRole('heading', { name: en.screens.deck });
    await context.auth.signOut();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: en.screens.login })).toBeInTheDocument(),
    );
  });
});
