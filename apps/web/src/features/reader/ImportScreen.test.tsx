import { configure, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData } from '../../lib/db';
import {
  endpointPattern,
  mockError,
  mockNetworkError,
  renderRoute,
  server,
} from '../../test/utils';
import { pollTiming, TEXT_IMPORT_MAX_CHARS } from './analysis';
import { MOCK_FAIL_MARKER, readerMockStore, resetReaderMock } from './mocks';

// Lazy routes and the mock server can be slow on a busy machine.
configure({ asyncUtilTimeout: 5_000 });

const BODY = 'Bývam v Bratislave. Dnes idem do kina.';

beforeEach(async () => {
  resetReaderMock();
  await clearLocalData();
  pollTiming.baseMs = 20;
});

afterEach(() => {
  pollTiming.baseMs = 1_000;
});

async function openImport() {
  const result = renderRoute('/read/import');
  await screen.findByRole('heading', { name: 'Import a text', level: 1 });
  return result;
}

function bodyField() {
  return screen.getByLabelText('Slovak text');
}

describe('import form', () => {
  it('counts characters against the limit and refuses a text that is too long', async () => {
    await openImport();
    const counter = screen.getByTestId('char-counter');
    expect(counter).toHaveTextContent('0 / 20,000');
    fireEvent.change(bodyField(), { target: { value: 'x'.repeat(TEXT_IMPORT_MAX_CHARS + 5) } });
    expect(counter).toHaveTextContent('20,005 / 20,000');
    expect(screen.getByText('The text is 5 characters too long.')).toBeInTheDocument();
    expect(bodyField()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('asks for a text before sending', async () => {
    await openImport();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText('Paste a text first.')).toBeInTheDocument();
  });

  it('pastes, sends, shows the processing state while polling, then opens the reader', async () => {
    const polls: number[] = [];
    server.use(
      http.get(endpointPattern('texts.get'), () => {
        polls.push(Date.now());
        return undefined;
      }),
    );
    const { router } = await openImport();
    await userEvent.type(screen.getByLabelText('Title (optional)'), 'Môj text');
    await userEvent.click(bodyField());
    await userEvent.paste(BODY);
    expect(screen.getByTestId('char-counter')).toHaveTextContent(`${BODY.length} / 20,000`);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Analysing your text')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Môj text', level: 2 })).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/read\/[0-9a-f-]{36}$/);
    // Two polls while processing, and one more that found it ready.
    expect(polls.length).toBeGreaterThanOrEqual(2);
    const stored = Object.values(readerMockStore().texts).find(
      (t) => t.detail.title === 'Môj text',
    );
    expect(stored?.detail.body).toBe(BODY);
  });

  it('shows the failure state and retries with the same text', async () => {
    await openImport();
    await userEvent.click(bodyField());
    await userEvent.paste(`${BODY} ${MOCK_FAIL_MARKER}`);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('The analysis failed.')).toBeInTheDocument();
    const before = Object.keys(readerMockStore().texts).length;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // A new text is created and the failed one removed; it fails again in the mock.
    await waitFor(() => expect(Object.keys(readerMockStore().texts)).toHaveLength(before));
    expect(await screen.findByText('The analysis failed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit the text' }));
    expect(bodyField()).toHaveValue(`${BODY} ${MOCK_FAIL_MARKER}`);
  });

  it('explains a rate limit and a missing connection', async () => {
    server.use(mockError('texts.create', 'rate_limited', { details: { retryAfterSeconds: 1200 } }));
    await openImport();
    await userEvent.click(bodyField());
    await userEvent.paste(BODY);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many imports in a short time. Try again in 20 min.',
    );
    server.resetHandlers();
    server.use(mockNetworkError('texts.create'));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/Importing needs a connection/)).toBeInTheDocument();
  });
});
