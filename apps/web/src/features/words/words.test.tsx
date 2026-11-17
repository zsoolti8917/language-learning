import { examples, type LemmaDetail } from '@app/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApi } from '../../lib/api';
import { parseResponse } from '../../lib/api/validate';
import { clearLocalData, db, outbox } from '../../lib/db';
import { en } from '../../messages';
import { mockEndpoint, mockNetworkError, renderRoute, server } from '../../test/utils';
import { m } from './messages';
import { enableFeatureMocks } from './mockHttp';
import { resetWordsMock } from './mocks';

const MESTO = examples['lemmas.get'].ok[0]?.response.body as LemmaDetail;

beforeAll(() => {
  enableFeatureMocks(true);
  // Every answer the screens read must fit the contract.
  configureApi({ onResponse: (name, data) => void parseResponse(name, data) });
});
afterAll(() => {
  enableFeatureMocks(false);
  configureApi({ onResponse: () => {} });
});

beforeEach(async () => {
  resetWordsMock();
  await clearLocalData(db);
});

describe('band overview', () => {
  it('lists the bands with their progress and opens one', async () => {
    const user = userEvent.setup();
    const { router } = renderRoute('/words');
    expect(await screen.findByRole('heading', { name: en.screens.words, level: 1 })).toBeVisible();
    const ring = await screen.findByRole('progressbar', { name: 'Known in words 1–500' });
    expect(ring).toHaveAttribute('aria-valuenow', '7');
    expect(screen.getByText('7 known · 3 learning · 62 new')).toBeVisible();
    await user.click(screen.getByRole('link', { name: /Words 1–500/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/words/band/0'));
  });

  it('shows an empty state when there are no bands', async () => {
    server.use(mockEndpoint('words.bands', { bands: [] }));
    renderRoute('/words');
    expect(await screen.findByText(m.t('overview.empty'))).toBeVisible();
  });

  it('shows the offline state when the bands cannot be fetched', async () => {
    server.use(mockNetworkError('words.bands'));
    renderRoute('/words');
    expect(await screen.findByText(m.t('common.offline'))).toBeVisible();
    expect(screen.getByRole('button', { name: m.t('common.retry') })).toBeVisible();
  });
});

describe('band list', () => {
  it('filters the words of a band by status', async () => {
    const user = userEvent.setup();
    renderRoute('/words/band/0');
    expect(await screen.findByRole('heading', { name: en.screens.band, level: 1 })).toBeVisible();
    expect(await screen.findByText('Words 1–500')).toBeVisible();
    // All: the first page of 50 and a button for more.
    const panel = await screen.findByRole('tabpanel');
    await waitFor(() => expect(within(panel).getAllByRole('link')).toHaveLength(50));
    await user.click(within(panel).getByRole('button', { name: m.t('band.more') }));
    await waitFor(() => expect(within(panel).getAllByRole('link')).toHaveLength(72));

    await user.click(screen.getByRole('tab', { name: m.t('status.learning') }));
    const learning = await screen.findByRole('tabpanel');
    await waitFor(() =>
      expect(
        within(learning)
          .getAllByRole('link')
          .map((a) => a.dataset.lemma),
      ).toEqual(['6', '20', '12']),
    );
    await user.click(screen.getByRole('tab', { name: m.t('status.ignored') }));
    expect(await screen.findByText(m.t('band.empty'))).toBeVisible();
  });
});

describe('sorting mode', () => {
  it('sorting 45 words sends two full batches and one partial batch on leaving', async () => {
    const user = userEvent.setup();
    const sent: { lemmaId: number; decision: string }[][] = [];
    server.use(
      mockEndpoint('words.triage', ({ body }) => {
        sent.push(body.decisions);
        return { updated: body.decisions.length, notesCreated: 0 };
      }),
    );
    renderRoute('/words/band/0');
    await user.click(await screen.findByRole('button', { name: m.t('band.sort') }));
    expect(await screen.findByText('0 of 62')).toBeVisible();

    // The meaning is hidden until asked for.
    expect(screen.queryByTestId('sort-gloss')).toBeNull();
    await user.click(screen.getByRole('button', { name: m.t('sort.showMeaning') }));
    expect(screen.getByTestId('sort-gloss')).toBeVisible();

    const buttons = [m.t('sort.known'), m.t('sort.learn'), m.t('sort.ignore')];
    for (let i = 0; i < 45; i++) {
      await user.click(screen.getByRole('button', { name: buttons[i % 3] }));
    }
    expect(await screen.findByText('45 of 62')).toBeVisible();
    // Nothing reached the server yet in this test (the outbox is not started here),
    // and the local statuses already changed.
    expect((await outbox.list()).map((r) => r.name)).toEqual(['words.triage', 'words.triage']);
    expect(await db.lemmaStatus.count()).toBeGreaterThanOrEqual(45);

    await user.click(screen.getByRole('button', { name: m.t('sort.finish') }));
    await waitFor(() => expect(sent.map((b) => b.length)).toEqual([20, 20, 5]));
    expect(sent[0]?.[0]?.decision).toBe('known');
    expect(sent[0]?.[1]?.decision).toBe('learn');
    expect(sent[0]?.[2]?.decision).toBe('ignored');
    await waitFor(async () => expect(await outbox.list()).toEqual([]));
    // Back on the list, which the sorting refreshed.
    expect(await screen.findByRole('button', { name: m.t('band.sort') })).toBeVisible();
  });

  it('undo takes the last decision out of the waiting batch', async () => {
    const user = userEvent.setup();
    const sent: { lemmaId: number; decision: string }[][] = [];
    server.use(
      mockEndpoint('words.triage', ({ body }) => {
        sent.push(body.decisions);
        return { updated: body.decisions.length, notesCreated: 0 };
      }),
    );
    renderRoute('/words/band/0');
    await user.click(await screen.findByRole('button', { name: m.t('band.sort') }));
    const undo = await screen.findByRole('button', { name: m.t('sort.undo') });
    expect(undo).toBeDisabled();

    const first = screen.getByTestId('sort-lemma').textContent;
    await user.click(screen.getByRole('button', { name: m.t('sort.known') }));
    const second = screen.getByTestId('sort-lemma').textContent;
    await user.click(screen.getByRole('button', { name: m.t('sort.learn') }));
    expect(screen.getByText('2 of 62')).toBeVisible();

    await user.click(undo);
    // The second word is back on screen and its decision is gone.
    await waitFor(() => expect(screen.getByTestId('sort-lemma').textContent).toBe(second));
    expect(screen.getByText('1 of 62')).toBeVisible();
    expect(first).not.toBe(second);

    await user.click(screen.getByRole('button', { name: m.t('sort.finish') }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toHaveLength(1);
    expect(sent[0]?.[0]?.decision).toBe('known');
  });

  it('decides by swiping the card', async () => {
    const user = userEvent.setup();
    renderRoute('/words/band/0');
    await user.click(await screen.findByRole('button', { name: m.t('band.sort') }));
    const card = await screen.findByTestId('sort-card');
    const lemma = screen.getByTestId('sort-lemma').textContent;
    await user.pointer([
      { keys: '[TouchA>]', target: card, coords: { clientX: 200, clientY: 300 } },
      { pointerName: 'TouchA', target: card, coords: { clientX: 320, clientY: 310 } },
      { keys: '[/TouchA]', target: card, coords: { clientX: 320, clientY: 310 } },
    ]);
    await waitFor(() => expect(screen.getByTestId('sort-lemma').textContent).not.toBe(lemma));
    expect(screen.getByText('1 of 62')).toBeVisible();
    await waitFor(async () => {
      const row = (await outbox.list()).length;
      const pending = await db.kv.get('words.triage.waiting');
      expect(row).toBe(0);
      expect(pending?.value).toEqual([
        expect.objectContaining({ decision: 'known', previous: null }),
      ]);
    });
  });
});

describe('word page', () => {
  it('renders mesto with a table of six cases by two numbers', async () => {
    renderRoute('/lemma/20');
    expect(await screen.findByRole('heading', { name: en.screens.lemma, level: 1 })).toBeVisible();
    expect(await screen.findByTestId('lemma-title')).toHaveTextContent('mesto');
    expect(screen.getByText('town, city')).toBeVisible();

    const table = screen.getByRole('table', { name: m.t('lemma.formsLabel', { lemma: 'mesto' }) });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(7); // header and six cases
    expect(within(rows[0] as HTMLElement).getAllByRole('columnheader')).toHaveLength(3);
    const body = rows.slice(1).map((r) => [
      r.getAttribute('data-case-row'),
      ...within(r)
        .getAllByRole('cell')
        .map((c) => c.textContent?.replace(` (${m.t('lemma.top')})`, '')),
    ]);
    expect(body).toEqual([
      ['nom', 'mesto', 'mestá'],
      ['gen', 'mesta', 'miest'],
      ['dat', 'mestu', 'mestám'],
      ['acc', 'mesto', 'mestá'],
      ['loc', 'meste', 'mestách'],
      ['ins', 'mestom', 'mestami'],
    ]);
    // Case colours come with the case name.
    expect(within(table).getByText('Locative').closest('[data-case]')).toHaveAttribute(
      'data-case',
      'loc',
    );
    // The most used forms are highlighted, and say so to screen readers.
    const top = table.querySelectorAll('[data-top]');
    expect([...top].map((e) => e.textContent?.split(' (')[0])).toEqual(['mesto', 'mesta', 'meste']);

    // Example sentence with the form marked, the status and the note link.
    const example = screen.getByText('mesta', { selector: 'mark' });
    expect(example.closest('p')).toHaveTextContent('Idem do mesta.');
    expect(screen.getByRole('button', { name: /Learning/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('link', { name: /Open the note/ })).toHaveAttribute(
      'href',
      `/deck/${MESTO.noteId}`,
    );
  });

  it('renders the contract example of mesto as the API would send it', async () => {
    server.use(mockEndpoint('lemmas.get', MESTO));
    renderRoute('/lemma/20');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(within(table).getAllByRole('cell')).toHaveLength(12);
  });

  it('marks machine written glosses', async () => {
    server.use(
      mockEndpoint('lemmas.get', {
        ...MESTO,
        senses: [
          ...MESTO.senses,
          { ord: 1, glossEn: 'municipality', note: null, source: 'generated', verified: false },
        ],
      }),
    );
    renderRoute('/lemma/20');
    const machine = await screen.findByText('municipality');
    expect(machine.closest('li')?.querySelector('[data-machine]')).toHaveTextContent(
      m.t('lemma.machine'),
    );
    expect(
      screen.getByText('town, city').closest('li')?.querySelector('[data-machine]'),
    ).toBeNull();
  });

  it('changes the status through the outbox', async () => {
    const user = userEvent.setup();
    renderRoute('/lemma/20');
    await screen.findByTestId('lemma-title');
    await user.click(screen.getByRole('button', { name: m.t('status.known') }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Known/ })).toHaveAttribute('aria-pressed', 'true'),
    );
    const rows = await outbox.list();
    expect(rows.map((r) => [r.name, r.input])).toEqual([
      ['lemmas.setStatus', { params: { id: '20' }, body: { status: 'known' } }],
    ]);
    expect((await db.lemmaStatus.get(20))?.status).toBe('known');
  });

  it('shows not found for an unknown word', async () => {
    renderRoute('/lemma/999');
    expect(await screen.findByText(m.t('lemma.notFound'))).toBeVisible();
  });

  it('shows the offline state with a retry', async () => {
    server.use(mockNetworkError('lemmas.get'));
    renderRoute('/lemma/20');
    expect(await screen.findByText(m.t('common.offline'))).toBeVisible();
  });
});
