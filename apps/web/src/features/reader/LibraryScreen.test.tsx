import { examples, type LibraryItem } from '@app/contracts';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData, storeText } from '../../lib/db';
import { mockEndpoint, mockError, mockNetworkError, renderRoute, server } from '../../test/utils';
import { EXAMPLE_TEXT, EXAMPLE_TEXT_ID } from './fixtures';
import { resetReaderMock } from './mocks';

// Lazy routes and the mock server can be slow on a busy machine.
configure({ asyncUtilTimeout: 5_000 });

beforeEach(async () => {
  resetReaderMock();
  await clearLocalData();
});

async function openLibrary() {
  const result = renderRoute('/read');
  await screen.findByRole('heading', { name: 'Library', level: 1 });
  return result;
}

describe('library', () => {
  it('lists the learner’s texts and the starter texts, each with its coverage', async () => {
    await openLibrary();
    const own = await screen.findByRole('link', { name: /V Bratislave/ });
    expect(own).toHaveAttribute('href', `/read/${EXAMPLE_TEXT_ID}`);
    expect(within(own).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '86% known');
    expect(own).toHaveTextContent('9 words');
    const starter = (await screen.findByText('Môj deň')).closest('div') as HTMLElement;
    expect(within(starter).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '62% known');
    expect(starter).toHaveTextContent('Level A2 · 84 words');
    expect(screen.getByRole('link', { name: 'Import a text' })).toHaveAttribute(
      'href',
      '/read/import',
    );
  });

  it('adds a starter text and opens it', async () => {
    const [item] = (examples['library.list'].ok[0].response.body as { items: LibraryItem[] }).items;
    const { textId: _added, ...notAdded } = item as LibraryItem;
    server.use(mockEndpoint('library.list', { items: [notAdded] }));
    const { router } = await openLibrary();
    const starter = (await screen.findByText('Môj deň')).closest('div') as HTMLElement;
    await userEvent.click(within(starter).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/read\/[0-9a-f-]{36}$/));
    expect(await screen.findByRole('heading', { name: 'Môj deň', level: 2 })).toBeInTheDocument();
  });

  it('shows an empty state that leads to the import', async () => {
    server.use(mockEndpoint('texts.list', { items: [], nextCursor: null }));
    await openLibrary();
    expect(await screen.findByText('No texts yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Import a text' })).toHaveLength(2);
  });

  it('shows an error with a retry', async () => {
    server.use(mockError('texts.list', 'internal'));
    await openLibrary();
    expect(await screen.findByText('The library could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offline, lists the texts opened on this device', async () => {
    await storeText({ ...EXAMPLE_TEXT, title: 'Stored text' });
    server.use(mockNetworkError('texts.list'), mockNetworkError('library.list'));
    await openLibrary();
    expect(await screen.findByText(/You are offline/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Stored text/ })).toHaveAttribute(
      'href',
      `/read/${EXAMPLE_TEXT_ID}`,
    );
  });

  it('offline with nothing stored says so', async () => {
    server.use(mockNetworkError('texts.list'), mockNetworkError('library.list'));
    await openLibrary();
    expect(
      await screen.findByText('You are offline, and no text has been opened on this device yet.'),
    ).toBeInTheDocument();
  });
});
