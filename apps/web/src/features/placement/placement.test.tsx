import { examples, type Profile } from '@app/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiKey, configureApi } from '../../lib/api';
import { parseResponse } from '../../lib/api/validate';
import { clearLocalData, db } from '../../lib/db';
import { en } from '../../messages';
import { mockEndpoint, mockNetworkError, renderRoute, server } from '../../test/utils';
import { enableFeatureMocks } from '../words/mockHttp';
import { m } from './messages';
import { MINI_CASE_ITEMS } from './mockData';
import { VOCAB_PER_ROUND, VOCAB_ROUNDS, vocabRound } from './mocks';
import { loadRun } from './run';

const PROFILE = examples['profile.get'].ok[0]?.response.body as Profile;
/** A learner on the first run: neither onboarding nor placement done. */
const FIRST_RUN: Profile = { ...PROFILE, settings: {}, placementDoneAt: null };

type User = ReturnType<typeof userEvent.setup>;

beforeAll(() => {
  enableFeatureMocks(true);
  configureApi({ onResponse: (name, data) => void parseResponse(name, data) });
});
afterAll(() => {
  enableFeatureMocks(false);
  configureApi({ onResponse: () => {} });
});

beforeEach(async () => {
  await clearLocalData(db);
  sessionStorage.clear();
  server.use(mockEndpoint('profile.get', FIRST_RUN));
});

/** The right option of a word, from the mock's answer key. */
function correctOf(lemma: string | null): number {
  for (let r = 1; r <= VOCAB_ROUNDS; r++) {
    const hit = vocabRound(r).find((v) => v.item.lemma === lemma);
    if (hit) return hit.correct;
  }
  throw new Error(`no such word: ${lemma}`);
}

async function answerVocab(user: User, count: number) {
  for (let i = 0; i < count; i++) {
    const group = await screen.findByRole('group', { name: /^Meanings of / }, { timeout: 3000 });
    const options = within(group).getAllByRole('button');
    // Every other word right, the others "I don't know".
    const lemma = screen.getByTestId('placement-lemma').textContent;
    await user.click(options[i % 2 === 0 ? correctOf(lemma) : options.length - 1] as HTMLElement);
  }
}

async function answerCases(user: User, count: number) {
  for (let i = 0; i < count; i++) {
    const field = await screen.findByRole(
      'textbox',
      { name: m.t('cases.answerLabel') },
      { timeout: 3000 },
    );
    const item = MINI_CASE_ITEMS[i];
    if (i % 2 === 0 && item) {
      await user.type(field, `${item.answers[0]}{Enter}`);
    } else {
      await user.click(screen.getByRole('button', { name: m.t('cases.dontKnow') }));
    }
  }
}

describe('placement check', () => {
  it('runs from the introduction through four rounds to the result, then Today', async () => {
    const user = userEvent.setup();
    const { router, context } = renderRoute('/placement');
    expect(
      await screen.findByRole('heading', { name: en.screens.placement, level: 1 }),
    ).toBeVisible();
    await user.click(await screen.findByRole('button', { name: m.t('intro.start') }));

    const bar = await screen.findByRole('progressbar', { name: m.t('progress.label') });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText(/Round 1 of 4/)).toBeVisible();

    await answerVocab(user, VOCAB_PER_ROUND);
    expect(await screen.findByText(/Round 2 of 4/)).toBeVisible();
    expect(screen.getByRole('progressbar', { name: m.t('progress.label') })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    await answerVocab(user, VOCAB_PER_ROUND * 2);
    expect(await screen.findByText(/Round 4 of 4/)).toBeVisible();

    // The case round: typed answers, no feedback after an answer.
    const field = await screen.findByRole('textbox', { name: m.t('cases.answerLabel') });
    expect(field).toHaveAttribute('lang', 'sk');
    expect(screen.getByTestId('placement-sentence').textContent).not.toContain('___');
    await answerCases(user, 1);
    expect(screen.queryByText(/Correct|Wrong|Almost/)).toBeNull();
    await answerCases(user, MINI_CASE_ITEMS.length - 1);

    const result = await screen.findByTestId('placement-result');
    // Half the vocabulary right gives 1500; the first case item was right.
    expect(within(result).getByText(m.t('result.known', { count: 1500 }))).toBeVisible();
    expect(await within(result).findByText('Accusative singular')).toBeVisible();
    expect(result.querySelector('[data-lesson-start]')).toHaveAttribute(
      'data-lesson-start',
      MINI_CASE_ITEMS[1]?.lessonId,
    );

    // The result marks placement done on the cached profile, so the first run guard lets go.
    const cached = context.queryClient.getQueryData<Profile>(apiKey('profile.get'));
    expect(cached?.placementDoneAt).toEqual(expect.any(String));
    expect(cached?.currentLessonId).toBe(MINI_CASE_ITEMS[1]?.lessonId);

    await user.click(screen.getByRole('button', { name: m.t('result.continue') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
    expect(await loadRun()).toBeUndefined();
  });

  it('resumes the run after a reload in the middle of a round', async () => {
    const user = userEvent.setup();
    const first = renderRoute('/placement');
    await user.click(await screen.findByRole('button', { name: m.t('intro.start') }));
    await answerVocab(user, VOCAB_PER_ROUND + 2);
    expect(await screen.findByText(/Round 2 of 4/)).toBeVisible();
    const shown = screen.getByTestId('placement-lemma').textContent;
    first.unmount();

    // A new app instance: the run comes back from the local database and the server.
    renderRoute('/placement');
    expect(await screen.findByText(/Round 2 of 4/)).toBeVisible();
    expect(screen.getByText(`3 of ${VOCAB_PER_ROUND}`)).toBeVisible();
    expect(screen.getByTestId('placement-lemma').textContent).toBe(shown);
    expect(screen.queryByRole('button', { name: m.t('intro.start') })).toBeNull();

    await answerVocab(user, VOCAB_PER_ROUND - 2);
    expect(await screen.findByText(/Round 3 of 4/)).toBeVisible();
  });

  it('keeps the answers when sending a round fails, and sends them again', async () => {
    const user = userEvent.setup();
    renderRoute('/placement');
    await user.click(await screen.findByRole('button', { name: m.t('intro.start') }));
    server.use(mockNetworkError('placement.answer', { once: true }));
    await answerVocab(user, VOCAB_PER_ROUND);
    expect(await screen.findByText(m.t('submit.error'))).toBeVisible();
    await user.click(screen.getByRole('button', { name: m.t('submit.retry') }));
    expect(await screen.findByText(/Round 2 of 4/)).toBeVisible();
  });

  it('shows the result again when the run had finished', async () => {
    const user = userEvent.setup();
    const first = renderRoute('/placement');
    await user.click(await screen.findByRole('button', { name: m.t('intro.start') }));
    await answerVocab(user, VOCAB_PER_ROUND * 3);
    await answerCases(user, MINI_CASE_ITEMS.length);
    await screen.findByTestId('placement-result');
    first.unmount();
    renderRoute('/placement');
    expect(await screen.findByTestId('placement-result')).toBeVisible();
  });

  it('tells the learner when the check cannot start offline', async () => {
    const user = userEvent.setup();
    server.use(mockNetworkError('placement.start'));
    renderRoute('/placement');
    await user.click(await screen.findByRole('button', { name: m.t('intro.start') }));
    expect(await screen.findByText(m.t('common.offline'))).toBeVisible();
    expect(await loadRun()).toBeUndefined();
  });
});
