import { SubmitAttemptsSchema } from '@app/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { en } from '../../messages';
import { mockNetworkError, renderRoute, server } from '../../test/utils';
import { EX_KNIHU, EX_ZENU } from './fixtures';
import { m } from './messages';
import { useCasesMock } from './test-helpers';

const mock = useCasesMock();

type User = ReturnType<typeof userEvent.setup>;

const progressCalls = () =>
  mock.log
    .filter((r) => r.method === 'PUT' && r.path.endsWith('/declension/lessons/acc-sg/progress'))
    .map((r) => r.body);

const field = () => screen.getByLabelText(m.t('item.gapLabel'));
const stepLabel = () => screen.getByTestId('step-label');

async function open(user: User) {
  renderRoute('/cases/lesson/acc-sg');
  expect(await screen.findByRole('heading', { name: en.screens.lesson, level: 1 })).toBeVisible();
  expect(await screen.findByRole('heading', { name: 'Accusative singular' })).toBeVisible();
  return user;
}

async function throughPractice(user: User) {
  // 1 Meaning: the text with its highlighted example.
  expect(stepLabel()).toHaveTextContent('Step 1 of 5 · Meaning');
  expect(screen.getByText('ženu', { selector: 'mark' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: m.t('lesson.continue') }));

  // 2 Triggers: a card per trigger with its case.
  await waitFor(() => expect(stepLabel()).toHaveTextContent('Step 2 of 5 · Triggers'));
  const card = screen.getByText('pre').closest('[data-trigger]') as HTMLElement;
  expect(within(card).getByText('Accusative')).toBeVisible();
  expect(within(card).getByText('Kúpim kávu pre brata.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: m.t('lesson.continue') }));

  // 3 Comprehension: a choice item; a wrong pick explains and allows one retry.
  await waitFor(() => expect(stepLabel()).toHaveTextContent('Step 3 of 5 · Comprehension'));
  await user.click(screen.getByRole('button', { name: 'žene' }));
  expect(document.body).toHaveTextContent(
    'That form can be the dative singular or locative singular. This sentence needs the accusative. Try once more.',
  );
  await user.click(screen.getByRole('button', { name: 'ženu' }));
  expect(document.body).toHaveTextContent('Right: ženu.');
  await user.click(screen.getByRole('button', { name: m.t('lesson.continue') }));

  // 4 Production: a typed gap with a hint.
  await waitFor(() => expect(stepLabel()).toHaveTextContent('Step 4 of 5 · Production'));
  expect(screen.getByText('Hint: kniha')).toBeVisible();
  await user.type(field(), 'knihu{Enter}');
  await user.click(screen.getByRole('button', { name: m.t('lesson.continue') }));
  await waitFor(() => expect(stepLabel()).toHaveTextContent('Step 5 of 5 · Checkpoint'));
}

async function checkpoint(user: User, typed: string) {
  // EX_KNIHU typed, then EX_ZENU chosen. No retry inside the checkpoint.
  await user.type(field(), `${typed}{Enter}`);
  await user.click(screen.getByRole('button', { name: m.t('item.next') }));
  await user.click(screen.getByRole('button', { name: 'ženu' }));
  await user.click(screen.getByRole('button', { name: m.t('lesson.continue') }));
}

describe('lesson player', () => {
  it('runs a lesson from the first step to completion and saves progress after each step', async () => {
    const user = await open(userEvent.setup());
    await throughPractice(user);
    await checkpoint(user, 'knihu');

    const done = await screen.findByTestId('lesson-complete');
    expect(done).toHaveTextContent('You scored 2 of 2.');
    // The cards the completion added, from the deck.
    const cards = await within(done).findByTestId('added-cards');
    expect(
      within(cards)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['žena', 'kniha']);

    expect(progressCalls()).toEqual([
      { stepIndex: 1, status: 'in_progress' },
      { stepIndex: 2, status: 'in_progress' },
      { stepIndex: 3, status: 'in_progress' },
      { stepIndex: 4, status: 'in_progress' },
      { stepIndex: 4, status: 'completed', score: { correct: 2, total: 2 } },
    ]);

    // Lesson attempts go out too: one batch per exercise step.
    const lessonAttempts = () =>
      mock.log
        .filter((r) => r.path.endsWith('/declension/attempts'))
        .flatMap((r) => SubmitAttemptsSchema.parse(r.body).attempts);
    await waitFor(() => expect(lessonAttempts()).toHaveLength(5));
    const attempts = lessonAttempts();
    expect(attempts.every((a) => a.source === 'lesson' && a.sessionId === undefined)).toBe(true);
    expect(attempts.map((a) => [a.exerciseId, a.typed, a.retry])).toEqual([
      [EX_ZENU.exerciseId, 'žene', false],
      [EX_ZENU.exerciseId, 'ženu', true],
      [EX_KNIHU.exerciseId, 'knihu', false],
      [EX_KNIHU.exerciseId, 'knihu', false],
      [EX_ZENU.exerciseId, 'ženu', false],
    ]);
  });

  it('does not complete the lesson after a failed checkpoint, and a retry can pass it', async () => {
    const user = await open(userEvent.setup());
    await throughPractice(user);
    await checkpoint(user, 'kniha');

    const failed = await screen.findByTestId('checkpoint-failed');
    expect(failed).toHaveTextContent('You scored 1 of 2.');
    expect(failed).toHaveTextContent('You need 75% to pass.');
    expect(screen.queryByTestId('lesson-complete')).toBeNull();
    expect(progressCalls().some((b) => (b as { status?: string }).status === 'completed')).toBe(
      false,
    );

    await user.click(screen.getByRole('button', { name: m.t('lesson.retryCheckpoint') }));
    expect(stepLabel()).toHaveTextContent('Step 5 of 5 · Checkpoint');
    await checkpoint(user, 'knihu');
    expect(await screen.findByTestId('lesson-complete')).toBeVisible();
    expect(progressCalls().at(-1)).toEqual({
      stepIndex: 4,
      status: 'completed',
      score: { correct: 2, total: 2 },
    });
  });

  it('resumes at the saved step', async () => {
    renderRoute('/cases/lesson/loc-sg');
    expect(await screen.findByRole('heading', { name: 'Locative singular' })).toBeVisible();
    expect(stepLabel()).toHaveTextContent('Step 1 of 5 · Meaning');
    // The dataset's locative lesson: its markdown list and examples render.
    expect(screen.getByText('Bratislave', { selector: 'mark' })).toBeVisible();
  });

  it('shows an offline state when the lesson cannot load', async () => {
    server.use(mockNetworkError('declension.lesson'));
    renderRoute('/cases/lesson/acc-sg');
    expect(await screen.findByText(m.t('state.offline'))).toBeVisible();
    expect(screen.getByRole('button', { name: m.t('state.retry') })).toBeVisible();
  });

  it('says so when the lesson does not exist', async () => {
    renderRoute('/cases/lesson/nope');
    expect(await screen.findByText(m.t('lesson.notFound'))).toBeVisible();
  });
});
