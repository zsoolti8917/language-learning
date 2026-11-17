// The mock helpers: `mockEndpoint`, `mockError`, `mockNetworkError`, `sseResponse` and the
// default handlers that replay the contract examples. This module never imports
// features/*/mocks.ts, so a feature's mocks.ts may import it and call `mockEndpoint` at module
// load. src/mocks/handlers.ts re-exports everything here and adds the feature handlers.
import {
  type EndpointName,
  ERROR_STATUS,
  type ErrorCode,
  endpointList,
  examples,
  formatSseEvent,
  type TutorStreamEvent,
} from '@app/contracts';
import { delay, type HttpHandler, HttpResponse, http } from 'msw';
import type { ApiInput, ApiResult } from '../lib/api/client';
import { ENDPOINT_META } from '../lib/api/endpoints.gen';
import { env } from '../lib/env';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** The URL pattern MSW matches for an endpoint, under the client's API base. */
export function endpointPattern(name: EndpointName, base = env.apiBase): string {
  const b = base.replace(/\/$/, '');
  const path = `${b}${ENDPOINT_META[name].path}`;
  return /^https?:\/\//.test(b) ? path : `*${path}`;
}

export interface MockRequestInfo<N extends EndpointName> {
  request: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The parsed JSON body, if any. */
  body: ApiInput<N> extends { body: infer B } ? B : undefined;
}

type MockReply<N extends EndpointName> =
  | (ApiResult<N> extends AsyncIterable<unknown> ? TutorStreamEvent[] : ApiResult<N>)
  | Response;

export type MockResolver<N extends EndpointName> = (
  info: MockRequestInfo<N>,
) => MockReply<N> | Promise<MockReply<N>>;

/** A ReadableStream response in the wire format of the tutor stream. */
export function sseResponse(
  events: readonly TutorStreamEvent[],
  options: { delayMs?: number } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const e of events) {
        if (options.delayMs) await delay(options.delayMs);
        controller.enqueue(encoder.encode(formatSseEvent(e)));
      }
      controller.close();
    },
  });
  return new HttpResponse(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * A handler for one endpoint by name. Pass the reply body (typed by the contract), a stream
 * of events for `tutor.sendMessage`, or a resolver that gets the parsed request:
 * `mockEndpoint('review.queue', { items: [], counts, serverTime })`,
 * `mockEndpoint('notes.create', ({ body }) => ({ ...detail, note: { ...detail.note, id: body.id } }))`.
 */
export function mockEndpoint<N extends EndpointName>(
  name: N,
  reply: MockReply<N> | MockResolver<N>,
  options: { status?: number; once?: boolean; delayMs?: number } = {},
): HttpHandler {
  const meta = ENDPOINT_META[name];
  const method = meta.method.toLowerCase() as Method;
  return http[method](
    endpointPattern(name),
    async ({ request, params }) => {
      const info = {
        request,
        params: params as Record<string, string>,
        query: new URL(request.url).searchParams,
        body: (await readJson(request.clone())) as MockRequestInfo<N>['body'],
      };
      const value =
        typeof reply === 'function'
          ? await (reply as MockResolver<N>)(info)
          : (reply as MockReply<N>);
      if (options.delayMs) await delay(options.delayMs);
      if (value instanceof Response) return value;
      if (meta.stream) return sseResponse(value as TutorStreamEvent[]);
      const status = options.status ?? meta.status;
      if (status === 204) return new HttpResponse(null, { status });
      return HttpResponse.json(value as never, { status });
    },
    { once: options.once ?? false },
  );
}

/** A handler that answers an endpoint with an error of the contract's shape. */
export function mockError<N extends EndpointName>(
  name: N,
  code: ErrorCode,
  options: { message?: string; details?: Record<string, unknown>; once?: boolean } = {},
): HttpHandler {
  const status = ERROR_STATUS[code];
  return mockEndpoint(
    name,
    () =>
      HttpResponse.json(
        {
          error: {
            code,
            message: options.message ?? code,
            ...(options.details ? { details: options.details } : {}),
          },
        },
        { status },
      ),
    { once: options.once ?? false },
  );
}

/** A handler whose request fails as if the network were down. */
export function mockNetworkError<N extends EndpointName>(
  name: N,
  options: { once?: boolean } = {},
): HttpHandler {
  return mockEndpoint(name, () => HttpResponse.error(), { once: options.once ?? false });
}

/** The default reply of an endpoint: its first `ok` example of @app/contracts. */
export function exampleHandler(name: EndpointName): HttpHandler {
  const ex = examples[name].ok[0] as {
    response: { status: number; body?: unknown };
    stream?: TutorStreamEvent[];
  };
  return mockEndpoint(name, () => {
    if (ex.stream) return sseResponse(ex.stream);
    if (ex.response.status === 204) return new HttpResponse(null, { status: 204 });
    return HttpResponse.json(ex.response.body as never, { status: ex.response.status });
  });
}

/** One default handler per endpoint, in the order of the contract. */
export const defaultHandlers: HttpHandler[] = endpointList.map((e) =>
  exampleHandler(e.name as EndpointName),
);
