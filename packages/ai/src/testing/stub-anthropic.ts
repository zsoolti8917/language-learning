// A real SDK client whose `fetch` is a stub: no network, no key. Each request takes the next
// queued reply, which becomes a JSON message, a server sent event stream, or an HTTP error, so
// the SDK's own request building, stream parsing, retries and error classes all run.
// Import it from test code only.
import Anthropic from '@anthropic-ai/sdk';

export interface StubUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

export type StubReply =
  /** A message: the text (pieces when streamed), stop reason and usage. */
  | {
      kind: 'message';
      text: string | string[];
      stopReason?: Anthropic.StopReason;
      refusalCategory?: Anthropic.RefusalStopDetails['category'];
      usage?: StubUsage;
      /** Adds a thinking block before the text, as adaptive thinking does. */
      thinking?: boolean;
    }
  /** An HTTP error with the API's error body. */
  | { kind: 'http_error'; status: number; type?: string }
  /** The connection fails. */
  | { kind: 'network_error' };

export interface StubRequest {
  url: string;
  body: Anthropic.MessageCreateParams & { stream?: boolean };
  headers: Record<string, string>;
}

export interface StubAnthropic {
  client: Anthropic;
  /** Queues replies; each HTTP request (retries too) takes the next one. */
  reply(...replies: StubReply[]): StubAnthropic;
  /** Every request the SDK sent, parsed. */
  readonly requests: readonly StubRequest[];
  /** Replies not used yet. */
  pending(): number;
}

let ids = 0;

function usageOf(u: StubUsage = {}) {
  const write1h = u.ephemeral_1h_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  return {
    input_tokens: u.input_tokens ?? 10,
    output_tokens: u.output_tokens ?? 5,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: write,
    cache_creation: {
      ephemeral_5m_input_tokens: write - write1h,
      ephemeral_1h_input_tokens: write1h,
    },
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: 'standard',
    speed: 'standard',
  };
}

function stopDetails(r: Extract<StubReply, { kind: 'message' }>) {
  return (r.stopReason ?? 'end_turn') === 'refusal'
    ? { type: 'refusal', category: r.refusalCategory ?? null, explanation: null }
    : null;
}

function messageJson(r: Extract<StubReply, { kind: 'message' }>, model: string, id: string) {
  const text = Array.isArray(r.text) ? r.text.join('') : r.text;
  const content: unknown[] = [];
  if (r.thinking) content.push({ type: 'thinking', thinking: '', signature: 'sig' });
  content.push({ type: 'text', text, citations: null });
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content,
    container: null,
    diagnostics: null,
    stop_reason: r.stopReason ?? 'end_turn',
    stop_sequence: null,
    stop_details: stopDetails(r),
    usage: usageOf(r.usage),
  };
}

/** The events of a streamed message; the text deltas are paced so an abort lands between them. */
function sseEvents(r: Extract<StubReply, { kind: 'message' }>, model: string, id: string) {
  const pieces = Array.isArray(r.text) ? r.text : [r.text];
  const usage = usageOf(r.usage);
  const events: [string, unknown][] = [];
  events.push([
    'message_start',
    {
      type: 'message_start',
      message: {
        ...messageJson({ ...r, text: '' }, model, id),
        content: [],
        stop_reason: null,
        stop_details: null,
        usage: { ...usage, output_tokens: 1 },
      },
    },
  ]);
  let index = 0;
  if (r.thinking) {
    events.push([
      'content_block_start',
      {
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
    ]);
    events.push([
      'content_block_delta',
      { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } },
    ]);
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
    index++;
  }
  events.push([
    'content_block_start',
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '', citations: null },
    },
  ]);
  for (const p of pieces)
    events.push([
      'content_block_delta',
      { type: 'content_block_delta', index, delta: { type: 'text_delta', text: p } },
    ]);
  events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  events.push([
    'message_delta',
    {
      type: 'message_delta',
      delta: {
        stop_reason: r.stopReason ?? 'end_turn',
        stop_sequence: null,
        stop_details: stopDetails(r),
      },
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        output_tokens_details: null,
        server_tool_use: null,
      },
    },
  ]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events;
}

function sseBody(events: [string, unknown][], signal: AbortSignal | null | undefined) {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      // A macrotask between events gives the consumer time to act (and abort).
      await new Promise((r) => setTimeout(r, 0));
      if (signal?.aborted) {
        ctrl.error(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      const ev = events[i++];
      if (!ev) {
        ctrl.close();
        return;
      }
      ctrl.enqueue(enc.encode(`event: ${ev[0]}\ndata: ${JSON.stringify(ev[1])}\n\n`));
    },
  });
}

export function createStubAnthropic(opts: { maxRetries?: number } = {}): StubAnthropic {
  const queue: StubReply[] = [];
  const requests: StubRequest[] = [];

  const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? '{}'));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    requests.push({ url, body, headers });
    const r = queue.shift();
    if (!r) throw new Error(`stub Anthropic: no reply queued for request ${requests.length}`);
    const id = `msg_stub_${++ids}`;
    const requestId = `req_stub_${ids}`;
    if (r.kind === 'network_error') throw new TypeError('fetch failed');
    if (r.kind === 'http_error') {
      return new Response(
        JSON.stringify({
          type: 'error',
          error: { type: r.type ?? 'api_error', message: 'stubbed error' },
          request_id: requestId,
        }),
        {
          status: r.status,
          headers: {
            'content-type': 'application/json',
            'request-id': requestId,
            // No waiting between the SDK's retries in tests.
            'retry-after-ms': '0',
          },
        },
      );
    }
    if (body.stream) {
      return new Response(sseBody(sseEvents(r, body.model, id), init?.signal), {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'request-id': requestId },
      });
    }
    return new Response(JSON.stringify(messageJson(r, body.model, id)), {
      status: 200,
      headers: { 'content-type': 'application/json', 'request-id': requestId },
    });
  };

  const client = new Anthropic({
    apiKey: 'test-key-not-real',
    fetch: fetchStub as typeof fetch,
    maxRetries: opts.maxRetries ?? 0,
  });

  const stub: StubAnthropic = {
    client,
    reply(...replies) {
      queue.push(...replies);
      return stub;
    },
    get requests() {
      return requests;
    },
    pending: () => queue.length,
  };
  return stub;
}
