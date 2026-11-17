import type { TriageDecision } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { kvGet } from '../../lib/db';
import { testOutbox } from '../../test/utils';
import { TRIAGE_BATCH_SIZE, TriageBatcher } from './triage';

const DECISIONS: TriageDecision[] = ['known', 'learn', 'ignored'];

async function triageRows(outbox: ReturnType<typeof testOutbox>) {
  return (await outbox.list())
    .filter((r) => r.name === 'words.triage')
    .map((r) => (r.input as { body: { decisions: unknown[] } }).body.decisions);
}

describe('TriageBatcher', () => {
  it('sorting 45 words gives two full batches and one partial batch on leaving', async () => {
    // Offline and never started: the outbox only collects.
    const outbox = testOutbox({ isOnline: () => false });
    const batcher = new TriageBatcher({ outbox });
    for (let i = 1; i <= 45; i++) {
      await batcher.decide(i, DECISIONS[i % 3] as TriageDecision);
    }
    // The newest decisions wait (so the last can be undone); two full batches went out.
    expect((await triageRows(outbox)).map((d) => d.length)).toEqual([20, 20]);
    expect(batcher.pending).toHaveLength(5);

    expect(await batcher.leave()).toBe(5);
    const rows = await triageRows(outbox);
    expect(rows.map((d) => d.length)).toEqual([20, 20, 5]);
    expect(rows[0]?.[0]).toEqual({ lemmaId: 1, decision: 'learn' });
    expect(rows[2]?.[4]).toEqual({ lemmaId: 45, decision: 'known' });
    // Leaving twice sends nothing more.
    expect(await batcher.leave()).toBe(0);
    expect(await triageRows(outbox)).toHaveLength(3);
  });

  it('keeps each batch its own outbox item instead of merging waiting batches', async () => {
    const outbox = testOutbox({ isOnline: () => false });
    const batcher = new TriageBatcher({ outbox, size: TRIAGE_BATCH_SIZE });
    for (let i = 1; i <= 41; i++) await batcher.decide(i, 'known');
    expect((await triageRows(outbox)).map((d) => d.length)).toEqual([20, 20]);
  });

  it('undo removes the last decision from the waiting batch and restores the status', async () => {
    const outbox = testOutbox({ isOnline: () => false });
    await outbox.db.lemmaStatus.put({ lemmaId: 2, status: 'learning', updatedAt: 'x' });
    const batcher = new TriageBatcher({ outbox });
    await batcher.decide(1, 'known');
    await batcher.decide(2, 'ignored');
    expect((await outbox.db.lemmaStatus.get(2))?.status).toBe('ignored');

    const undone = await batcher.undo();
    expect(undone).toMatchObject({ lemmaId: 2, decision: 'ignored', previous: 'learning' });
    expect(batcher.pending.map((d) => d.lemmaId)).toEqual([1]);
    expect((await outbox.db.lemmaStatus.get(2))?.status).toBe('learning');

    await batcher.undo();
    expect(await outbox.db.lemmaStatus.get(1)).toBeUndefined();
    expect(await batcher.undo()).toBeNull();

    await batcher.leave();
    expect(await triageRows(outbox)).toEqual([]);
  });

  it('undo after a full batch went out still takes back only the waiting decision', async () => {
    const outbox = testOutbox({ isOnline: () => false });
    const batcher = new TriageBatcher({ outbox });
    for (let i = 1; i <= 21; i++) await batcher.decide(i, 'learn');
    expect(await batcher.undo()).toMatchObject({ lemmaId: 21 });
    await batcher.leave();
    expect((await triageRows(outbox)).map((d) => d.length)).toEqual([20]);
  });

  it('a batch left behind by a closed tab is sent on the next start', async () => {
    const outbox = testOutbox({ isOnline: () => false });
    const first = new TriageBatcher({ outbox });
    await first.decide(7, 'known');
    await first.decide(8, 'learn');
    expect(await kvGet('words.triage.waiting', outbox.db)).toHaveLength(2);

    const second = new TriageBatcher({ outbox });
    expect(await second.recover()).toBe(2);
    expect(await triageRows(outbox)).toEqual([
      [
        { lemmaId: 7, decision: 'known' },
        { lemmaId: 8, decision: 'learn' },
      ],
    ]);
    expect(await kvGet('words.triage.waiting', outbox.db)).toEqual([]);
  });
});
