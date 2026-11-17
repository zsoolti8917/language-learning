import type { Profile, Today } from '@app/contracts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { swEvents } from '../../lib/pwa';
import { en } from '../../messages';
import {
  mockEndpoint,
  mockError,
  mockNetworkError,
  renderRoute,
  renderWithProviders,
  server,
} from '../../test/utils';
import { AppNotices } from './AppNotices';
import { EXAMPLE_PROFILE, TODAY_DONE, TODAY_FRESH, TODAY_MIDDLE, TODAY_VARIANTS } from './fixtures';
import { m } from './messages';
import { MOCK_TODAY_KEY } from './mocks';

const ONBOARDED_FRESH: Profile = {
  ...EXAMPLE_PROFILE,
  displayName: null,
  placementDoneAt: null,
  settings: { onboardedAt: '2026-11-17T08:00:00.000Z' },
};

function showToday(today: Today, profile: Profile = EXAMPLE_PROFILE) {
  server.use(mockEndpoint('profile.today', today), mockEndpoint('profile.get', profile));
  return renderRoute('/');
}

const heading = () => screen.findByRole('heading', { name: en.screens.today, level: 1 });
const link = (name: string) => screen.getByRole('link', { name });

afterEach(() => {
  swEvents.reset();
  vi.restoreAllMocks();
});

describe('Today', () => {
  it('a fresh account: the first run card leads to the placement check', async () => {
    showToday(TODAY_FRESH, ONBOARDED_FRESH);
    await heading();
    expect(await screen.findByText(m.t('today.firstRunTitle'))).toBeInTheDocument();
    expect(link(m.t('today.firstRunAction'))).toHaveAttribute('href', '/placement');
    expect(screen.getByText(m.t('today.greetingAnon'), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(m.t('today.reviewsNone'))).toBeInTheDocument();
    expect(screen.queryByText(m.t('today.doneTitle'))).toBeNull();
    expect(link(m.t('today.readLibrary'))).toHaveAttribute('href', '/read');
    expect(link(m.t('today.lessonAction'))).toHaveAttribute('href', '/cases/lesson/acc-sg');
    expect(screen.queryByText(m.t('today.weakTitle'))).toBeNull();
    expect(screen.queryByText(m.t('today.tutorTitle'))).toBeNull();
    expect(screen.getByText('0 of 500 known, 0 learning')).toBeInTheDocument();
  });

  it('the middle of the course: reviews, text, lesson, weak cases, tutor and words', async () => {
    showToday(TODAY_MIDDLE);
    await heading();
    expect(
      await screen.findByText(m.t('today.greeting', { name: 'Learner' }), { exact: false }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Tuesday, November 17', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(m.t('today.firstRunTitle'))).toBeNull();
    expect(screen.queryByText(m.t('today.doneTitle'))).toBeNull();
    expect(screen.getByText('12 due')).toBeInTheDocument();
    expect(screen.getByText('5 new')).toBeInTheDocument();
    expect(screen.getByText('2 learning')).toBeInTheDocument();
    expect(link(m.t('today.reviewsStart'))).toHaveAttribute('href', '/review');
    expect(screen.getByText('V Bratislave')).toHaveAttribute('lang', 'sk');
    expect(screen.getByText(m.t('today.readCoverage', { percent: 86 }))).toBeInTheDocument();
    expect(link(m.t('today.readAction'))).toHaveAttribute(
      'href',
      `/read/${TODAY_MIDDLE.continueText?.id}`,
    );
    expect(screen.getByText('Locative singular')).toBeInTheDocument();
    expect(link(m.t('today.lessonContinue'))).toHaveAttribute('href', '/cases/lesson/loc-sg');
    const weak = screen.getByText(m.t('today.weakTitle')).closest('div') as HTMLElement;
    expect(within(weak).getByText('Locative')).toBeInTheDocument();
    expect(within(weak).getByText('48% right')).toBeInTheDocument();
    expect(link(m.t('today.weakAction'))).toHaveAttribute('href', '/cases/train');
    expect(screen.getByText('Kde si?')).toBeInTheDocument();
    expect(link(m.t('today.tutorAction'))).toHaveAttribute('href', '/tutor');
    expect(screen.getByRole('progressbar', { name: m.t('today.wordsRing') })).toHaveAttribute(
      'aria-valuenow',
      '212',
    );
    expect(link(m.t('today.wordsAction'))).toHaveAttribute('href', '/words');
  });

  it('everything done for the day', async () => {
    showToday(TODAY_DONE);
    await heading();
    expect(await screen.findByText(m.t('today.doneTitle'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: m.t('today.reviewsStart') })).toBeNull();
    expect(screen.getByText(m.t('today.reviewsNone'))).toBeInTheDocument();
    expect(screen.queryByText(m.t('today.firstRunTitle'))).toBeNull();
  });

  it('starts reviews from the button', async () => {
    showToday(TODAY_MIDDLE);
    await heading();
    await userEvent.click(await screen.findByRole('link', { name: m.t('today.reviewsStart') }));
    expect(
      await screen.findByRole('heading', { name: en.screens.review, level: 1 }),
    ).toBeInTheDocument();
  });

  it('shows a loading state, then an error with a retry', async () => {
    server.use(mockError('profile.today', 'internal', { once: true }));
    renderRoute('/');
    await heading();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(await screen.findByText(m.t('today.loadFailed'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: m.t('today.retry') }));
    expect(await screen.findByText('12 due')).toBeInTheDocument();
  });

  it('says when it is offline without a plan', async () => {
    server.use(mockNetworkError('profile.today'));
    renderRoute('/');
    expect(await screen.findByText(m.t('today.offlineEmpty'))).toBeInTheDocument();
  });

  it('opens settings from the header', async () => {
    showToday(TODAY_MIDDLE);
    await heading();
    await userEvent.click(screen.getByRole('link', { name: m.t('today.settings') }));
    expect(
      await screen.findByRole('heading', { name: en.screens.settings, level: 1 }),
    ).toBeInTheDocument();
  });
});

describe('Today mock variants', () => {
  it('the mock server picks a variant from localStorage', async () => {
    for (const [name, body] of Object.entries(TODAY_VARIANTS)) {
      localStorage.setItem(MOCK_TODAY_KEY, name);
      const res = await fetch('http://localhost/api/v1/today');
      expect(await res.json()).toEqual(body);
    }
  });
});

describe('notices', () => {
  it('shows the offline indicator', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithProviders(<AppNotices />);
    expect(screen.getByText(m.t('notices.offline'))).toBeInTheDocument();
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(m.t('notices.offline'))).toBeNull();
  });

  it('shows the update prompt and applies the update', async () => {
    const update = vi.fn(async () => {});
    swEvents.setUpdater(update);
    renderWithProviders(<AppNotices />);
    expect(screen.queryByText(m.t('notices.updateTitle'))).toBeNull();
    act(() => swEvents.needRefresh());
    await userEvent.click(screen.getByRole('button', { name: m.t('notices.updateAction') }));
    expect(update).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: m.t('notices.updateLater') }));
    expect(screen.queryByText(m.t('notices.updateTitle'))).toBeNull();
  });

  it('shows the iOS install hint once on iPhone Safari', async () => {
    const iphone = {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      standalone: false,
    };
    const { unmount } = renderWithProviders(<AppNotices platform={iphone} />);
    await userEvent.click(screen.getByRole('button', { name: m.t('notices.iosDismiss') }));
    expect(screen.queryByText(m.t('notices.iosTitle'))).toBeNull();
    unmount();
    renderWithProviders(<AppNotices platform={iphone} />);
    expect(screen.queryByText(m.t('notices.iosTitle'))).toBeNull();
  });

  it('shows no install hint in the installed app or on other phones', () => {
    renderWithProviders(
      <AppNotices
        platform={{ userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1', standalone: true }}
      />,
    );
    renderWithProviders(<AppNotices platform={{ userAgent: 'Mozilla/5.0 (Linux; Android)' }} />);
    expect(screen.queryByText(m.t('notices.iosTitle'))).toBeNull();
  });
});
