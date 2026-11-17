// The tutor's event stream: `text/event-stream` over a POST, read by the client with fetch.
import { formatSseEvent, type TutorStreamEvent } from '@app/contracts';

export interface SseOptions {
  /** A comment line every so many ms keeps proxies from closing the stream (default 15 s). */
  keepAliveMs?: number;
  /** Aborted when the client disconnects; `send` then does nothing, the producer runs on. */
  signal?: AbortSignal;
}

/**
 * Streams the events `produce` sends. The response returns at once; the stream closes when
 * `produce` settles. A thrown error becomes an `error` event with code `internal`. The
 * producer runs to its end even when the client goes away, so storage still completes.
 */
export function sseResponse(
  produce: (send: (event: TutorStreamEvent) => void) => Promise<void>,
  opts: SseOptions = {},
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string) => {
        if (closed || opts.signal?.aborted) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };
      timer = setInterval(() => write(': keep-alive\n\n'), opts.keepAliveMs ?? 15_000);
      produce((e) => write(formatSseEvent(e)))
        .catch(() =>
          write(
            formatSseEvent({
              event: 'error',
              data: { code: 'internal', message: 'Something went wrong.' },
            }),
          ),
        )
        .finally(() => {
          clearInterval(timer);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed by the client
            }
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

/** Parses a whole event stream body back into events (tests and tools). */
export function parseSse(text: string): { event: string; data: unknown }[] {
  const out: { event: string; data: unknown }[] = [];
  for (const block of text.split('\n\n')) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (data.length > 0) out.push({ event, data: JSON.parse(data.join('\n')) });
  }
  return out;
}
