import { TextDetailSchema } from '@app/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../lib/api';
import { clearLocalData, db, outbox, setLemmaStatuses, storeText } from '../../lib/db';
import { mergeStatuses, pendingLemmaIds, saveProgress, setWordStatus } from './data';
import { EXAMPLE_TEXT, EXAMPLE_TEXT_ID } from './fixtures';
import { MOCK_PROCESSING_POLLS, readerMockStore, resetReaderMock } from './mocks';

beforeEach(async () => {
  resetReaderMock();
  await clearLocalData();
});

describe('word statuses', () => {
  it('the server replaces local statuses, except for writes still waiting', async () => {
    await setLemmaStatuses([
      { lemmaId: 31, status: 'unknown' },
      { lemmaId: 21, status: 'known' },
    ]);
    // 21 has a write waiting; 31 does not.
    await setWordStatus(21, 'ignored');
    expect(await pendingLemmaIds()).toEqual(new Set(['21']));
    const merged = await mergeStatuses(EXAMPLE_TEXT, true);
    expect(merged['31']).toBe('known');
    expect(merged['21']).toBe('ignored');
    expect(merged['64']).toBe('known');
    // The local table now agrees with the server where nothing waits.
    expect((await db.lemmaStatus.get(31))?.status).toBe('known');
  });

  it('an offline copy uses the local statuses', async () => {
    await setLemmaStatuses([{ lemmaId: 31, status: 'learning' }]);
    const merged = await mergeStatuses(EXAMPLE_TEXT, false);
    expect(merged['31']).toBe('learning');
    expect(merged['21']).toBe('learning');
  });
});

describe('reading position', () => {
  it('is kept locally at once, and waiting updates of one text become one request', async () => {
    await storeText(EXAMPLE_TEXT);
    await saveProgress(EXAMPLE_TEXT_ID, 0);
    await saveProgress(EXAMPLE_TEXT_ID, 1);
    const rows = await outbox.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.input).toEqual({
      params: { id: EXAMPLE_TEXT_ID },
      body: { progress: { sentence: 1 } },
    });
    expect((await db.texts.get(EXAMPLE_TEXT_ID))?.progress).toEqual({ sentence: 1 });
    await outbox.flush();
    expect(readerMockStore().texts[EXAMPLE_TEXT_ID]?.detail.progress).toEqual({ sentence: 1 });
  });
});

describe('mock server', () => {
  it('processes an imported text over two polls into a valid ready text', async () => {
    const id = '0193a1b2-c3d4-7e5f-8a6b-0000000000b1';
    await api.texts.create({ body: { id, body: 'Dnes idem do kina.' } });
    const seen: string[] = [];
    for (let i = 0; i <= MOCK_PROCESSING_POLLS; i++) {
      seen.push((await api.texts.get({ params: { id } })).status);
    }
    expect(seen).toEqual(['processing', 'ready', 'ready']);
    const ready = await api.texts.get({ params: { id } });
    expect(TextDetailSchema.safeParse(ready).success).toBe(true);
    expect(ready.title).toBe('Dnes idem do kina.');
    const list = await api.texts.list({ query: { archived: 'false' } });
    expect(list.items.map((t) => t.id)).toContain(id);
  });
});
