// Reader for `text/event-stream` bodies (docs/contracts.md, "Tutor stream").
import type { TutorStreamEvent } from '@app/contracts';

const EVENT_NAMES = new Set<TutorStreamEvent['event']>(['analysis', 'delta', 'done', 'error']);

/** One raw server sent event: the `event:` name and the joined `data:` lines. */
export interface RawSseEvent {
  event: string;
  data: string;
}

/** Splits a byte stream into server sent events. Handles chunks cut anywhere and CRLF. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<RawSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];

  function* drain(final: boolean): Generator<RawSseEvent> {
    // Normalise line ends, then take whole lines only (unless the stream ended).
    buffer = buffer.replace(/\r\n?/g, '\n');
    let nl = buffer.indexOf('\n');
    while (nl !== -1 || (final && buffer.length > 0)) {
      const line = nl === -1 ? buffer : buffer.slice(0, nl);
      buffer = nl === -1 ? '' : buffer.slice(nl + 1);
      if (line === '') {
        if (data.length > 0) yield { event: event || 'message', data: data.join('\n') };
        event = '';
        data = [];
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      nl = buffer.indexOf('\n');
    }
    if (final && data.length > 0) {
      yield { event: event || 'message', data: data.join('\n') };
      data = [];
    }
  }

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        yield* drain(true);
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      yield* drain(false);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Thrown when the stream holds an event the contract does not know or bad JSON. */
export class StreamFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamFormatError';
  }
}

/**
 * Reads the tutor stream as typed events, in order: one `analysis`, many `delta`, one `done`,
 * or an `error` that ends it. The generator returns after `done` or `error`.
 */
export async function* readTutorStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<TutorStreamEvent> {
  for await (const raw of readSse(body, signal)) {
    if (!EVENT_NAMES.has(raw.event as TutorStreamEvent['event'])) {
      throw new StreamFormatError(`unknown stream event "${raw.event}"`);
    }
    let data: unknown;
    try {
      data = JSON.parse(raw.data);
    } catch {
      throw new StreamFormatError(`event "${raw.event}" carries invalid JSON`);
    }
    const ev = { event: raw.event, data } as TutorStreamEvent;
    yield ev;
    if (ev.event === 'done' || ev.event === 'error') return;
  }
}
