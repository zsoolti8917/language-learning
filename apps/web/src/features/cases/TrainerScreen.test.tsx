import { type ExerciseItem, SubmitAttemptsSchema } from '@app/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { outbox } from '../../lib/db';
import { en } from '../../messages';
import { mockEndpoint, renderRoute, server } from '../../test/utils';
import { EX_MESTA, EX_ULICE, EX_ZENAM, SESSION_ID, TRAINER_POOL } from './fixtures';
import { m } from './messages';
import { setOnline, useCasesMock } from './test-helpers';

const mock = useCasesMock();

afterEach(() => setOnline(true));

function sessionOf(items: ExerciseItem[]) {
  server.use(
    mockEndpoint('declension.createSession', ({ body }) => ({
      sessionId: SESSION_ID,
      seed: body.seed ?? 7,
      items,
    })),
  );
}

const attemptPosts = () =>
  mock.log.filter((r) => r.method === 'POST' && r.path.endsWith('/declension/attempts'));

async function startSession(user: ReturnType<typeof userEvent.setup>) {
  renderRoute('/cases/train');
  expect(await screen.findByRole('heading', { name: en.screens.trainer, level: 1 })).toBeVisible();
  await user.click(await screen.findByRole('button', { name: m.t('trainer.start') }));
  await screen.findByTestId('trainer-progress');
}

const field = () => screen.getByLabelText(m.t('item.gapLabel'));

async function typeAnswer(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.clear(field());
  await user.type(field(), `${text}{Enter}`);
}

/** Answers the item on screen correctly: types the answer or taps the right option. */
async function answerRight(user: ReturnType<typeof userEvent.setup>, item: ExerciseItem) {
  if (item.kind === 'cloze') await typeAnswer(user, item.answers[0] as string);
  else {
    const right = item.options?.find((o) => o.correct)?.text as string;
    await user.click(screen.getByRole('button', { name: right }));
  }
  await user.click(screen.getByRole('button', { name: /^(Next|Finish)$/ }));
}

describe('trainer', () => {
  it('explains do meste, zenam and z ulicy, allows one retry and sends one valid batch', async () => {
    const user = userEvent.setup();
    sessionOf([EX_MESTA, EX_ZENAM, EX_ULICE]);
    await startSession(user);

    // do meste: another case. The hint names the cases but keeps the answer back.
    await typeAnswer(user, 'meste');
    expect(document.body).toHaveTextContent(
      'That is the locative singular. After do comes the genitive. Try once more.',
    );
    expect(document.body).not.toHaveTextContent('do mesta');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    // The second try is right.
    await typeAnswer(user, 'mesta');
    expect(document.body).toHaveTextContent('Right: do mesta.');
    await user.click(screen.getByRole('button', { name: m.t('item.next') }));

    // zenam: the accents.
    await typeAnswer(user, 'zenam');
    expect(document.body).toHaveTextContent(
      'The letters are right, but the accents are not. Watch ž, á. Try once more.',
    );
    await typeAnswer(user, 'zenam');
    expect(document.body).toHaveTextContent(
      'The letters are right, but the accents are not: ženám.',
    );
    await user.click(screen.getByRole('button', { name: m.t('item.next') }));

    // z ulicy: an ending from another pattern.
    await typeAnswer(user, 'ulicy');
    expect(document.body).toHaveTextContent(
      'Ulica is a soft noun. The ending -y belongs to hard nouns like žena. Try once more.',
    );
    await typeAnswer(user, 'ulicy');
    expect(document.body).toHaveTextContent(
      'Ulica is a soft noun: z ulice. The ending -y belongs to hard nouns like žena.',
    );
    expect(screen.getByRole('link', { name: 'See the table of ulica' })).toHaveAttribute(
      'href',
      '/cases/pattern/ulica',
    );
    await user.click(screen.getByRole('button', { name: m.t('item.finish') }));

    expect(await screen.findByTestId('trainer-summary')).toBeVisible();
    await waitFor(() => expect(attemptPosts()).toHaveLength(1));
    const body = SubmitAttemptsSchema.parse(attemptPosts()[0]?.body);
    expect(
      body.attempts.map((a) => [a.exerciseId, a.typed, a.correct, a.retry, a.clientDiagnosis]),
    ).toEqual([
      [EX_MESTA.exerciseId, 'meste', false, false, 'other_case'],
      [EX_MESTA.exerciseId, 'mesta', true, true, 'correct'],
      [EX_ZENAM.exerciseId, 'zenam', false, false, 'diacritics'],
      [EX_ZENAM.exerciseId, 'zenam', false, true, 'diacritics'],
      [EX_ULICE.exerciseId, 'ulicy', false, false, 'wrong_pattern'],
      [EX_ULICE.exerciseId, 'ulicy', false, true, 'wrong_pattern'],
    ]);
    expect(new Set(body.attempts.map((a) => a.sessionId))).toEqual(new Set([SESSION_ID]));
    expect(body.attempts.every((a) => a.source === 'trainer')).toBe(true);

    // The summary: one of three right on the first try, the weak buckets named.
    const summary = screen.getByTestId('trainer-summary');
    expect(summary).toHaveTextContent('0 of 3 right on the first try');
    await waitFor(() => expect(summary).toHaveTextContent(m.t('trainer.synced')));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('weak'))
          .getAllByRole('listitem')
          .map((li) => li.dataset.bucket),
      ).toEqual(['gen.sg.n', 'dat.pl.f', 'gen.sg.f']),
    );
  });

  it('sends the attempts every five items and at the end', async () => {
    const user = userEvent.setup();
    await startSession(user); // the mock hands out the seven items of its pool
    for (const item of TRAINER_POOL) await answerRight(user, item);
    expect(await screen.findByTestId('trainer-summary')).toHaveTextContent(
      '7 of 7 right on the first try',
    );
    await waitFor(() => expect(attemptPosts()).toHaveLength(2));
    const [first, second] = attemptPosts().map((r) => SubmitAttemptsSchema.parse(r.body));
    expect(first?.attempts.map((a) => a.exerciseId)).toEqual(
      TRAINER_POOL.slice(0, 5).map((i) => i.exerciseId),
    );
    expect(second?.attempts.map((a) => a.exerciseId)).toEqual(
      TRAINER_POOL.slice(5).map((i) => i.exerciseId),
    );
    // The server's mastery reaches the summary: buckets that moved up are listed.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('improved')).getAllByRole('listitem').length,
      ).toBeGreaterThan(0),
    );
  });

  it('finishes a fetched session offline and sends the attempts once on reconnect', async () => {
    const user = userEvent.setup();
    const stop = outbox.start(window);
    try {
      sessionOf([EX_MESTA, EX_ULICE, EX_ZENAM]);
      await startSession(user);

      setOnline(false);
      await typeAnswer(user, 'meste');
      await typeAnswer(user, 'mesta');
      await user.click(screen.getByRole('button', { name: m.t('item.next') }));
      await answerRight(user, EX_ULICE);
      await answerRight(user, EX_ZENAM);

      const summary = await screen.findByTestId('trainer-summary');
      expect(summary).toHaveTextContent(m.t('trainer.syncing'));
      expect(attemptPosts()).toHaveLength(0);
      expect((await outbox.list()).map((r) => r.name)).toEqual(['declension.submitAttempts']);

      setOnline(true);
      await waitFor(() => expect(summary).toHaveTextContent(m.t('trainer.synced')));
      await outbox.syncNow();
      const sent = attemptPosts().flatMap((r) => SubmitAttemptsSchema.parse(r.body).attempts);
      expect(sent.map((a) => a.exerciseId)).toEqual([
        EX_MESTA.exerciseId,
        EX_MESTA.exerciseId,
        EX_ULICE.exerciseId,
        EX_ZENAM.exerciseId,
      ]);
      expect(new Set(sent.map((a) => a.id)).size).toBe(sent.length);
      expect(attemptPosts()).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it('resumes a started session after a reload', async () => {
    const user = userEvent.setup();
    sessionOf([EX_MESTA, EX_ULICE]);
    const first = renderRoute('/cases/train');
    await user.click(await screen.findByRole('button', { name: m.t('trainer.start') }));
    await screen.findByTestId('trainer-progress');
    await answerRight(user, EX_MESTA);
    await screen.findByText('2 / 2');
    first.unmount();

    renderRoute('/cases/train');
    const resume = await screen.findByTestId('resume');
    expect(resume).toHaveTextContent('1 of 2 items done.');
    await user.click(
      within(resume).getAllByRole('button', { name: m.t('trainer.resume') })[0] as HTMLElement,
    );
    expect(await screen.findByText('2 / 2')).toBeVisible();
    expect(screen.getByTestId('sentence')).toHaveTextContent('Idem z domov.');
  });

  it('cannot start without a connection', async () => {
    setOnline(false);
    renderRoute('/cases/train');
    expect(await screen.findByText(m.t('trainer.offlineStart'))).toBeVisible();
    expect(screen.getByRole('button', { name: m.t('trainer.start') })).toBeDisabled();
  });
});
