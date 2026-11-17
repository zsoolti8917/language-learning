import { type ConversationDetail, EXAMPLE_IDS, examples } from '@app/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { en } from '../../messages';
import { mockEndpoint, mockError, renderRoute, server } from '../../test/utils';
import { m } from './messages';

describe('scenario picker', () => {
  it('lists scenarios with goal, level, target cases and times done', async () => {
    renderRoute('/tutor');
    expect(
      await screen.findByRole('heading', { name: en.screens.scenarios, level: 1 }),
    ).toBeInTheDocument();
    const card = (await screen.findByRole('heading', { name: 'A walk in town' })).closest(
      '[data-scenario]',
    ) as HTMLElement;
    expect(within(card).getByText('Ideme do mesta')).toHaveAttribute('lang', 'sk');
    expect(card).toHaveTextContent(
      m.t('scenarios.goal', { goal: 'Say where you are going and who you are going with.' }),
    );
    expect(card).toHaveTextContent(m.t('scenarios.level', { level: 'A2' }));
    expect(card.querySelectorAll('[data-case]')).toHaveLength(2);
    expect(card).toHaveTextContent(m.t('scenarios.timesDoneOne'));
    const coach = screen
      .getByRole('heading', { name: 'Where are you?' })
      .closest('[data-scenario]');
    expect(coach).toHaveTextContent(m.t('scenarios.coach'));
    expect(coach).toHaveTextContent(m.t('scenarios.timesDone'));
  });

  it('lists conversations to continue', async () => {
    renderRoute('/tutor');
    const recent = await screen.findByRole('region', { name: m.t('scenarios.resumeTitle') });
    const link = within(recent).getByRole('link');
    expect(link).toHaveAttribute('href', `/tutor/${EXAMPLE_IDS.conversation}`);
    expect(link).toHaveTextContent(m.t('scenarios.resume'));
  });

  it('starts a conversation with a client id and opens the chat without another fetch', async () => {
    let started: { id: string; scenarioId: string } | undefined;
    let fetched = 0;
    const detail = examples['tutor.startConversation'].ok[0]?.response.body as ConversationDetail;
    server.use(
      mockEndpoint('tutor.startConversation', ({ body }) => {
        started = body;
        return detail;
      }),
      mockEndpoint('tutor.getConversation', () => {
        fetched += 1;
        return detail;
      }),
    );
    const user = userEvent.setup();
    const { router } = renderRoute('/tutor');
    const card = (await screen.findByRole('heading', { name: 'A walk in town' })).closest(
      '[data-scenario]',
    ) as HTMLElement;
    await user.click(within(card).getByRole('button', { name: m.t('scenarios.start') }));
    await screen.findByRole('heading', { name: en.screens.chat, level: 1 });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/tutor/${EXAMPLE_IDS.conversation}`),
    );
    expect(started?.scenarioId).toBe('scn-city-walk');
    expect(started?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Ideš dnes do mesta?')).toBeInTheDocument();
    expect(fetched).toBe(0);
  });

  it('shows an error toast when the start fails', async () => {
    server.use(mockError('tutor.startConversation', 'internal'));
    const user = userEvent.setup();
    renderRoute('/tutor');
    const card = (await screen.findByRole('heading', { name: 'A walk in town' })).closest(
      '[data-scenario]',
    ) as HTMLElement;
    await user.click(within(card).getByRole('button', { name: m.t('scenarios.start') }));
    expect(await screen.findByText(m.t('scenarios.startFailed'))).toBeInTheDocument();
  });

  it('has empty, error and loading states', async () => {
    server.use(mockEndpoint('tutor.scenarios', { items: [] }, { delayMs: 50 }));
    const a = renderRoute('/tutor');
    await screen.findByRole('heading', { name: en.screens.scenarios, level: 1 });
    expect(await screen.findByRole('status', { name: en.app.loading })).toBeInTheDocument();
    expect(await screen.findByText(m.t('scenarios.empty'))).toBeInTheDocument();
    a.unmount();

    server.use(mockError('tutor.scenarios', 'internal'));
    renderRoute('/tutor');
    expect(await screen.findByText(m.t('scenarios.loadFailed'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.app.retry })).toBeInTheDocument();
  });
});
