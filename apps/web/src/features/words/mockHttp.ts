// A small stand in for `mockEndpoint` of src/mocks/handlers, for the feature mock files of M5.
// src/mocks/handlers.ts imports every features/*/mocks.ts eagerly, so a feature mock that
// imports handlers.ts back runs before handlers.ts has initialised (a cycle; under Vitest it
// fails with "Cannot access … before initialization"). This helper needs only the endpoint
// table and the API base, so it has no cycle.
import type { EndpointName, RequestInput, ResponseOf } from '@app/contracts';
import { type HttpHandler, HttpResponse, http } from 'msw';
import { ENDPOINT_META } from '../../lib/api/endpoints.gen';
import { env } from '../../lib/env';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

// On in the browser's mock mode. Off under Vitest, where the shared client test
// (src/lib/api/client.test.ts) expects every endpoint to answer its contract example: a
// disabled handler answers nothing, so MSW falls through to the default example handler.
// The tests of M5 switch them on with `enableFeatureMocks(true)`.
let enabled = import.meta.env.MODE !== 'test';

export function enableFeatureMocks(on: boolean): void {
  enabled = on;
}

export interface FeatureMockInfo<N extends EndpointName> {
  params: Record<string, string>;
  query: URLSearchParams;
  body: RequestInput<N>['body'] | undefined;
}

/** The same URL pattern `endpointPattern` of src/mocks/handlers builds. */
function pattern(name: EndpointName): string {
  const base = env.apiBase.replace(/\/$/, '');
  const path = `${base}${ENDPOINT_META[name].path}`;
  return /^https?:\/\//.test(base) ? path : `*${path}`;
}

export function featureMock<N extends EndpointName>(
  name: N,
  resolve: (info: FeatureMockInfo<N>) => ResponseOf<N> | Response,
): HttpHandler {
  const meta = ENDPOINT_META[name];
  return http[meta.method.toLowerCase() as Method](pattern(name), async ({ request, params }) => {
    if (!enabled) return undefined;
    const text = request.method === 'GET' ? '' : await request.clone().text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    const value = resolve({
      params: params as Record<string, string>,
      query: new URL(request.url).searchParams,
      body: body as RequestInput<N>['body'] | undefined,
    });
    if (value instanceof Response) return value;
    return HttpResponse.json(value as never, { status: meta.status });
  });
}

/** An error answer in the contract's shape. */
export function errorResponse(code: 'not_found', message: string, status = 404): Response {
  return HttpResponse.json({ error: { code, message } }, { status });
}
