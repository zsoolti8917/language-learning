import type { EndpointName, TextDetail } from '@app/contracts';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { ENDPOINT_META } from '../../lib/api/endpoints.gen';
import { clearLocalData, db, getStoredText, outbox } from '../../lib/db';
import {
  endpointPattern,
  mockEndpoint,
  mockError,
  mockNetworkError,
  renderRoute,
  server,
} from '../../test/utils';
import { pollTiming } from './analysis';
import { EXAMPLE_TEXT, EXAMPLE_TEXT_ID, textDetail } from './fixtures';
import { mockAnalyze } from './mockAnalyzer';
import { MOCK_FAIL_MARKER, resetReaderMock } from './mocks';
import { PROGRESS_DELAY_MS } from './ReaderScreen';

// Lazy routes and the mock server can be slow on a busy machine.
configure({ asyncUtilTimeout: 5_000 });

/** Records the JSON bodies and URLs sent to an endpoint, then lets the next handler answer. */
function capture(name: EndpointName) {
  const calls: { url: string; body: unknown }[] = [];
  const method = ENDPOINT_META[name].method.toLowerCase() as 'post' | 'put' | 'patch';
  server.use(
    http[method](endpointPattern(name), async ({ request }) => {
      const text = await request.clone().text();
      calls.push({ url: request.url, body: text ? JSON.parse(text) : undefined });
      return undefined;
    }),
  );
  return calls;
}

async function openReader(id = EXAMPLE_TEXT_ID, title = EXAMPLE_TEXT.title) {
  const result = renderRoute(`/read/${id}`);
  await screen.findByRole('heading', { name: title, level: 2 });
  return result;
}

async function token(sentence: number, index: number): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>(
      `[data-sentence="${sentence}"] [data-token="${index}"]`,
    );
    if (!el) throw new Error(`no token ${sentence}.${index}`);
    return el;
  });
}

async function tap(sentence: number, index: number) {
  await userEvent.click(await token(sentence, index));
}

async function sheetFor(word: string) {
  return screen.findByRole('dialog', { name: word });
}

beforeEach(async () => {
  resetReaderMock();
  await clearLocalData();
});

afterEach(() => {
  pollTiming.baseMs = 1_000;
  vi.restoreAllMocks();
});

describe('reader view', () => {
  it('shows the title, the share of known words, and each word with its status', async () => {
    await openReader();
    expect(screen.getByRole('heading', { name: 'Reader', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Known words' })).toHaveAttribute(
      'aria-valuetext',
      '86% known',
    );
    expect(await token(1, 3)).toHaveAttribute('data-status', 'learning');
    expect(await token(0, 2)).toHaveAttribute('data-status', 'known');
    // Opened texts are kept for offline reading.
    await waitFor(async () => expect(await getStoredText(EXAMPLE_TEXT_ID)).toBeDefined());
  });
});

describe('the word sheet', () => {
  it('a noun after a preposition: gloss, dictionary form, case, number and the trigger', async () => {
    const before = vi.spyOn(globalThis, 'fetch');
    await openReader();
    const calls = before.mock.calls.length;
    await tap(1, 3);
    const sheet = await sheetFor('kina');
    // Built from the stored analysis: no request when the sheet opens.
    expect(before.mock.calls.length).toBe(calls);
    expect(within(sheet).getByTestId('gloss')).toHaveTextContent('cinema');
    expect(within(sheet).getByTestId('lemma')).toHaveTextContent('kino');
    expect(within(sheet).getByTestId('pos')).toHaveTextContent('(noun, neuter)');
    const form = within(sheet).getByTestId('form');
    expect(form).toHaveTextContent('Genitive');
    expect(form).toHaveTextContent('singular');
    expect(within(sheet).getByTestId('trigger')).toHaveTextContent(
      'After “do” comes the genitive.',
    );
    expect(within(sheet).queryByRole('note')).toBeNull();
    expect(within(sheet).getByRole('link', { name: 'All forms' })).toHaveAttribute(
      'href',
      '/lemma/21',
    );
    // kino is being learnt already.
    expect(within(sheet).getByRole('button', { name: 'Saved' })).toBeDisabled();
  });

  it('a guessed reading carries a hint', async () => {
    const body = 'Mám rád kávu.';
    server.use(mockEndpoint('texts.get', textDetail(body, mockAnalyze(body))));
    await openReader();
    await tap(0, 2);
    const sheet = await sheetFor('kávu');
    expect(within(sheet).getByRole('note')).toHaveTextContent('This reading is a guess');
    expect(within(sheet).getByTestId('gloss')).toHaveTextContent('No meaning stored yet.');
  });

  it('a punctuation mark opens nothing', async () => {
    await openReader();
    const sentence = (await token(0, 0)).closest('[data-sentence]') as HTMLElement;
    const stop = [...sentence.querySelectorAll('span')].find((s) => s.textContent === '.');
    expect(stop).toBeDefined();
    expect(stop?.closest('button')).toBeNull();
    await userEvent.click(stop as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('save', () => {
  it('sends POST /notes with the sentence; the colour changes at once and stays after a reload', async () => {
    server.use(mockEndpoint('texts.get', { ...EXAMPLE_TEXT, lemmaStatus: {} }));
    const first = await openReader();
    expect(await token(0, 2)).toHaveAttribute('data-status', 'unknown');
    await tap(0, 2);
    const sheet = await sheetFor('Bratislave');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await token(0, 2)).toHaveAttribute('data-status', 'learning');
    expect(await screen.findByText('“Bratislava” is in your deck.')).toBeInTheDocument();

    // Reload before the write went out: the server still says unknown, the local write wins.
    first.unmount();
    await openReader();
    expect(await token(0, 2)).toHaveAttribute('data-status', 'learning');

    const notes = capture('notes.create');
    await outbox.flush();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toMatchObject({
      kind: 'word',
      source: 'reader',
      lemmaId: 31,
      textId: EXAMPLE_TEXT_ID,
      context: {
        sentenceSk: 'Bývam v Bratislave.',
        blank: { start: 8, end: 18 },
        tag: 's6',
      },
    });
    expect(await outbox.list()).toHaveLength(0);
  });

  it('after the write is sent, the server keeps the status too', async () => {
    const view = await openReader();
    await tap(1, 0);
    await userEvent.click(within(await sheetFor('Dnes')).getByRole('button', { name: 'Known' }));
    await outbox.flush();
    view.unmount();
    await clearLocalData();
    await openReader();
    expect(await token(1, 0)).toHaveAttribute('data-status', 'known');
  });
});

describe('offline', () => {
  it('reads a text opened before, and sends words marked known later', async () => {
    const online = await openReader();
    await waitFor(async () => expect(await getStoredText(EXAMPLE_TEXT_ID)).toBeDefined());
    online.unmount();

    server.use(mockNetworkError('texts.get'), mockNetworkError('lemmas.setStatus'));
    await openReader();
    expect(screen.getByTestId('offline-note')).toHaveTextContent('Offline copy');
    await tap(1, 3);
    await userEvent.click(within(await sheetFor('kina')).getByRole('button', { name: 'Known' }));
    expect(await token(1, 3)).toHaveAttribute('data-status', 'known');

    // Still offline: the write waits.
    await outbox.flush();
    const waiting = await outbox.list();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ name: 'lemmas.setStatus', status: 'pending' });

    // Back online: it goes out once.
    server.resetHandlers();
    const sent = capture('lemmas.setStatus');
    await outbox.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toMatch(/\/lemmas\/21\/status$/);
    expect(sent[0]?.body).toEqual({ status: 'known' });
    expect(await outbox.list()).toHaveLength(0);
    expect((await db.lemmaStatus.get(21))?.status).toBe('known');
  });

  it('says so when a text was never opened on this device', async () => {
    server.use(mockNetworkError('texts.get'));
    renderRoute(`/read/${EXAMPLE_TEXT_ID}`);
    expect(
      await screen.findByText(
        'You are offline, and this text was not opened on this device before.',
      ),
    ).toBeInTheDocument();
  });

  it('shows not found and load errors with a retry', async () => {
    server.use(mockError('texts.get', 'not_found'));
    renderRoute(`/read/${EXAMPLE_TEXT_ID}`);
    expect(await screen.findByText('This text does not exist.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('more actions', () => {
  it('translates a sentence on request and keeps the translation', async () => {
    await openReader();
    await tap(0, 2);
    const sheet = await sheetFor('Bratislave');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Translate the sentence' }));
    expect(await within(sheet).findByTestId('translation')).toHaveTextContent(
      '(Mock translation of sentence 1.)',
    );
    const stored = await getStoredText(EXAMPLE_TEXT_ID);
    expect(stored?.analysis?.sentences[0]?.en).toBe('(Mock translation of sentence 1.)');
  });

  it('saves a phrase with a meaning the learner can edit', async () => {
    await openReader();
    await tap(1, 2);
    await userEvent.click(
      within(await sheetFor('do')).getByRole('button', { name: 'Select a phrase' }),
    );
    const bar = await screen.findByTestId('phrase-bar');
    expect(bar).toHaveTextContent('Tap the last word of the phrase.');
    await tap(1, 3);
    expect(bar).toHaveTextContent('2 words: do kina');
    expect(await token(1, 2)).toHaveAttribute('aria-pressed', 'true');
    // vaul keeps the closed word sheet mounted in jsdom (no animation end), so the page
    // around it stays aria-hidden here; in a browser it unmounts (see the Playwright test).
    await userEvent.click(within(bar).getByRole('button', { name: 'Save phrase', hidden: true }));
    const sheet = await screen.findByRole('dialog', { name: 'Save phrase' });
    const meaning = within(sheet).getByLabelText('Meaning');
    expect(meaning).toHaveValue('to, into cinema');
    await userEvent.clear(meaning);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phrase' }));
    expect(within(sheet).getByText('Write a meaning.')).toBeInTheDocument();
    await userEvent.type(meaning, 'to the cinema');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phrase' }));

    const notes = capture('notes.create');
    await outbox.flush();
    expect(notes[0]?.body).toMatchObject({
      kind: 'phrase',
      source: 'reader',
      textId: EXAMPLE_TEXT_ID,
      content: {
        kind: 'phrase',
        textSk: 'do kina',
        glossEn: 'to the cinema',
        context: {
          sentenceSk: 'Dnes idem do kina.',
          sentenceEn: 'Today I am going to the cinema.',
          blank: { start: 10, end: 17 },
        },
      },
    });
  });

  it('reports a word, naming the token', async () => {
    await openReader();
    await tap(1, 3);
    const sheet = await sheetFor('kina');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Report a problem' }));
    await userEvent.type(within(sheet).getByLabelText(/What looks wrong/), 'Wrong case');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send report' }));
    const reports = capture('reports.create');
    await outbox.flush();
    expect(reports[0]?.body).toMatchObject({
      targetKind: 'analysis_token',
      targetRef: `${EXAMPLE_TEXT_ID}:1:3:kina`,
      comment: 'Wrong case',
    });
  });

  it('saves the reading position after a delay, once', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 40,
      left: 0,
      right: 390,
      width: 390,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await openReader();
    await token(0, 0);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    await waitFor(
      async () => {
        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          name: 'texts.update',
          input: { params: { id: EXAMPLE_TEXT_ID }, body: { progress: { sentence: 0 } } },
        });
      },
      { timeout: PROGRESS_DELAY_MS + 3_000 },
    );
  });
});

describe('processing and failure', () => {
  it('polls a text while it is processed, then shows it', async () => {
    pollTiming.baseMs = 20;
    const id = '0193a1b2-c3d4-7e5f-8a6b-0000000000a1';
    await api.texts.create({ body: { id, title: 'Nový text', body: 'Dnes idem do kina.' } });
    renderRoute(`/read/${id}`);
    expect(await screen.findByText('Analysing your text')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Nový text', level: 2 })).toBeInTheDocument();
    expect(await token(0, 3)).toHaveTextContent('kina');
  });

  it('a failed analysis offers a retry that sends the text again', async () => {
    pollTiming.baseMs = 20;
    const id = '0193a1b2-c3d4-7e5f-8a6b-0000000000a2';
    const body = `Dnes idem do kina. ${MOCK_FAIL_MARKER}`;
    await api.texts.create({ body: { id, body } });
    const { router } = renderRoute(`/read/${id}`);
    expect(await screen.findByText('The analysis failed.')).toBeInTheDocument();
    const created = capture('texts.create');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect((created[0]?.body as TextDetail | undefined)?.body).toBe(body);
    await waitFor(() => expect(router.state.location.pathname).not.toBe(`/read/${id}`));
  });
});
