// Small platform pieces: clock, ids, background work, the event stream, examples.
import { TUTOR_STREAM_EXAMPLE, TutorStreamEventSchema } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { createBackground } from './background';
import { createFixedClock, createSequentialIds, uuidV7Ids } from './clock';
import { parseSse, sseResponse } from './sse';
import { contractExample, exampleTutorStream } from './stub';

describe('clock and ids', () => {
  it('a fixed clock moves only when told', () => {
    const c = createFixedClock('2026-11-17T08:30:00Z');
    expect(c.now().toISOString()).toBe('2026-11-17T08:30:00.000Z');
    c.advance(60_000);
    expect(c.now().toISOString()).toBe('2026-11-17T08:31:00.000Z');
    c.set('2027-01-01T00:00:00Z');
    expect(c.now().getUTCFullYear()).toBe(2027);
  });

  it('ids are uuids; v7 ids sort by time', () => {
    const seq = createSequentialIds();
    expect(seq.uuid()).toBe('00000000-0000-7000-8000-000000000001');
    expect(seq.uuid()).toBe('00000000-0000-7000-8000-000000000002');
    const a = uuidV7Ids.uuid();
    const b = uuidV7Ids.uuid();
    expect(a < b).toBe(true);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('runInBackground', () => {
  it('tracks tasks, logs failures and drains', async () => {
    const errors: unknown[] = [];
    const bg = createBackground((e) => errors.push(e));
    let done = false;
    bg.runInBackground(
      new Promise((r) => setTimeout(r, 5)).then(() => {
        done = true;
      }),
    );
    bg.runInBackground(Promise.reject(new Error('boom')));
    await bg.drain();
    expect(done).toBe(true);
    expect(errors).toHaveLength(1);
  });
});

describe('event stream', () => {
  it('sends events in order and closes', async () => {
    const res = exampleTutorStream();
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text());
    expect(events).toEqual(TUTOR_STREAM_EXAMPLE);
    for (const e of events) TutorStreamEventSchema.parse(e);
  });

  it('turns a failure into an error event and sends keep alives', async () => {
    const res = sseResponse(
      async (send) => {
        send({ event: 'delta', data: { text: 'a' } });
        await new Promise((r) => setTimeout(r, 30));
        throw new Error('secret detail');
      },
      { keepAliveMs: 10 },
    );
    const text = await res.text();
    expect(text).toContain(': keep-alive');
    expect(text).not.toContain('secret');
    expect(parseSse(text).map((e) => e.event)).toEqual(['delta', 'error']);
  });
});

describe('contract examples', () => {
  it('returns the parsed first example', () => {
    expect(contractExample('system.health').ok).toBe(true);
    expect(() => contractExample('profile.delete')).toThrow();
  });
});
