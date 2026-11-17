import {
  formatSseEvent,
  TUTOR_STREAM_BUDGET_ERROR,
  TUTOR_STREAM_EXAMPLE,
  type TutorStreamEvent,
  TutorStreamEventSchema,
} from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { mockEndpoint, server } from '../../test/utils';
import { createApiClient } from './client';
import { readSse, readTutorStream, StreamFormatError } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const wire = TUTOR_STREAM_EXAMPLE.map(formatSseEvent).join('');

describe('tutor stream reader', () => {
  it('parses the example event sequence: analysis, deltas, done', async () => {
    const events = await collect(readTutorStream(streamOf([wire])));
    expect(events).toEqual(TUTOR_STREAM_EXAMPLE);
    expect(events.map((e) => e.event)).toEqual(['analysis', 'delta', 'delta', 'done']);
    for (const e of events) expect(TutorStreamEventSchema.parse(e)).toEqual(e);
  });

  it('copes with chunks cut anywhere, even inside a multibyte letter', async () => {
    const bytes = new TextEncoder().encode(wire);
    for (const size of [1, 3, 7, 64]) {
      const parts: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += size) parts.push(bytes.slice(i, i + size));
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (const p of parts) c.enqueue(p);
          c.close();
        },
      });
      expect(await collect(readTutorStream(body))).toEqual(TUTOR_STREAM_EXAMPLE);
    }
  });

  it('accepts CRLF line ends, comments and multi line data', async () => {
    const raw = await collect(
      readSse(streamOf([': keep alive\r\nevent: delta\r\ndata: {"text":\r\ndata: "a"}\r\n\r\n'])),
    );
    expect(raw).toEqual([{ event: 'delta', data: '{"text":\n"a"}' }]);
  });

  it('ends on an error event', async () => {
    const after: TutorStreamEvent = { event: 'delta', data: { text: 'never' } };
    const body = streamOf([...TUTOR_STREAM_BUDGET_ERROR, after].map(formatSseEvent));
    expect(await collect(readTutorStream(body))).toEqual(TUTOR_STREAM_BUDGET_ERROR);
  });

  it('refuses unknown events and bad JSON', async () => {
    await expect(collect(readTutorStream(streamOf(['event: nope\ndata: {}\n\n'])))).rejects.toThrow(
      StreamFormatError,
    );
    await expect(collect(readTutorStream(streamOf(['event: delta\ndata: {\n\n'])))).rejects.toThrow(
      StreamFormatError,
    );
  });

  it('streams through the client, and cancel stops it', async () => {
    server.use(mockEndpoint('tutor.sendMessage', TUTOR_STREAM_EXAMPLE));
    const client = createApiClient();
    const input = {
      params: { id: '0193a1b2-c3d4-7e5f-8a6b-0000000000cc' },
      body: { clientId: 'm1', content: 'Idem do kino.' },
    };
    expect(await collect(await client.tutor.sendMessage(input))).toEqual(TUTOR_STREAM_EXAMPLE);

    const stream = await client.tutor.sendMessage(input);
    const seen: string[] = [];
    for await (const ev of stream) {
      seen.push(ev.event);
      stream.cancel();
      break;
    }
    expect(seen).toEqual(['analysis']);
  });
});
