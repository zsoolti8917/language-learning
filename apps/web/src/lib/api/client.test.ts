import {
  ENDPOINT_COUNT,
  type EndpointDef,
  type EndpointName,
  endpointList,
  endpoints,
  examples,
  TUTOR_STREAM_EXAMPLE,
  type TutorStreamEvent,
} from '@app/contracts';
import { HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultHandlers } from '../../mocks/endpoint';
import { mockEndpoint, mockError, mockNetworkError, server } from '../../test/utils';
import { createApiClient, type TutorStream } from './client';
import { ApiError } from './errors';
import { parseResponse } from './validate';

describe('typed client against the mock server', () => {
  const client = createApiClient({ getToken: () => 'dev:test' });

  // The contract example handlers only: features may override endpoints in their mocks.ts
  // (also under Vitest), and this test checks the defaults, not those overrides. Runtime
  // handlers come first; the global afterEach resets them.
  beforeEach(() => {
    server.use(...defaultHandlers);
  });

  it('has one typed function per endpoint', () => {
    expect(endpointList).toHaveLength(ENDPOINT_COUNT);
    for (const e of endpointList) {
      const [ns, action] = e.name.split('.') as [string, string];
      expect(
        typeof (client as unknown as Record<string, Record<string, unknown>>)[ns]?.[action],
      ).toBe('function');
    }
  });

  it.each(endpointList.map((e) => e.name as EndpointName))(
    '%s returns a response that parses with its schema',
    async (name) => {
      const example = examples[name].ok[0] as {
        request: unknown;
        response: { status: number; body?: unknown };
        stream?: TutorStreamEvent[];
      };
      const [ns, action] = name.split('.') as [string, string];
      const fn = (
        client as unknown as Record<string, Record<string, (i: unknown) => Promise<unknown>>>
      )[ns]?.[action];
      const result = await fn?.(example.request);
      const e = endpoints[name] as EndpointDef;
      if (e.stream) {
        const schema = e.stream;
        const events: TutorStreamEvent[] = [];
        for await (const ev of result as TutorStream)
          events.push(schema.parse(ev) as TutorStreamEvent);
        expect(events).toEqual(example.stream);
      } else if (e.status === 204) {
        expect(result).toBeUndefined();
      } else {
        expect(parseResponse(name, result)).toEqual(parseResponse(name, example.response.body));
      }
    },
  );
});

describe('requests', () => {
  it('sends the bearer token, path params, query and JSON body', async () => {
    let seen: { auth: string | null; url: string; body: unknown } | undefined;
    server.use(
      mockEndpoint('notes.update', async ({ request, body }) => {
        seen = { auth: request.headers.get('authorization'), url: request.url, body };
        return HttpResponse.json(examples['notes.update'].ok[0]?.response.body as never);
      }),
      mockEndpoint('words.list', ({ query }) => {
        seen = { auth: null, url: `?${query.toString()}`, body: undefined };
        return { items: [], nextCursor: null };
      }),
    );
    const client = createApiClient({ getToken: async () => 'dev:abc' });
    const id = '0193a1b2-c3d4-7e5f-8a6b-0000000000aa';
    await client.notes.update({ params: { id }, body: { suspended: true } });
    expect(seen?.auth).toBe('Bearer dev:abc');
    expect(seen?.url).toMatch(new RegExp(`/api/v1/notes/${id}$`));
    expect(seen?.body).toEqual({ suspended: true });

    await client.words.list({ query: { band: 2, status: 'unknown', limit: 20 } });
    expect(seen?.url).toBe('?band=2&status=unknown&limit=20');
  });

  it('sends no token to the health check', async () => {
    let auth: string | null = 'unset';
    server.use(
      mockEndpoint('system.health', ({ request }) => {
        auth = request.headers.get('authorization');
        return { ok: true, version: '1', contentVersion: '1' };
      }),
    );
    await createApiClient({ getToken: () => 'dev:x' }).system.health();
    expect(auth).toBeNull();
  });
});

describe('errors', () => {
  it('rejects with a typed ApiError from the error body', async () => {
    server.use(mockError('review.queue', 'rate_limited', { details: { retryAfterSeconds: 30 } }));
    const err = await createApiClient()
      .review.queue()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSeconds: 30 });
    expect((err as ApiError).isRetryable).toBe(true);
  });

  it('maps a body without the error shape by status', async () => {
    server.use(mockEndpoint('profile.get', () => new HttpResponse('nope', { status: 404 })));
    await expect(createApiClient().profile.get()).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      isRetryable: false,
    });
  });

  it('reports a failed network as code "network"', async () => {
    server.use(mockNetworkError('profile.get'));
    await expect(createApiClient().profile.get()).rejects.toMatchObject({
      status: 0,
      code: 'network',
      isNetwork: true,
    });
  });

  it('refreshes once after a 401 and repeats the call', async () => {
    let token = 'old';
    server.use(
      mockEndpoint('profile.get', ({ request }) =>
        request.headers.get('authorization') === 'Bearer new'
          ? HttpResponse.json(examples['profile.get'].ok[0]?.response.body as never)
          : HttpResponse.json({ error: { code: 'unauthorized', message: 'x' } }, { status: 401 }),
      ),
    );
    let refreshes = 0;
    const client = createApiClient({
      getToken: () => token,
      onUnauthorized: async () => {
        refreshes++;
        token = 'new';
        return true;
      },
    });
    await expect(client.profile.get()).resolves.toMatchObject({ displayName: 'Learner' });
    expect(refreshes).toBe(1);

    token = 'bad';
    const stuck = createApiClient({ getToken: () => 'bad', onUnauthorized: async () => true });
    await expect(stuck.profile.get()).rejects.toMatchObject({ status: 401 });
  });

  it('answers 409 conflict for a stream that cannot start, before any event', async () => {
    server.use(mockError('tutor.sendMessage', 'conflict'));
    await expect(
      createApiClient().tutor.sendMessage({
        params: { id: '0193a1b2-c3d4-7e5f-8a6b-0000000000bb' },
        body: { clientId: 'c1', content: 'Ahoj' },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect(TUTOR_STREAM_EXAMPLE.length).toBeGreaterThan(0);
  });
});
