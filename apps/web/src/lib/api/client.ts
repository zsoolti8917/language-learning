// The typed API client: one function per endpoint of the @app/contracts table.
// Runtime facts (method, path, status) come from the generated endpoints.gen.ts,
// types from @app/contracts, so the first load ships no zod.
import type { EndpointName, RequestInput, ResponseOf, TutorStreamEvent } from '@app/contracts';
import { ENDPOINT_META } from './endpoints.gen';
import { ApiError } from './errors';
import { readTutorStream } from './sse';

type Meta = typeof ENDPOINT_META;

type Present<T> = [T] extends [never] ? false : true;

/** What one call takes: `params` and `body` when the endpoint has them, `query` optionally. */
export type ApiInput<N extends EndpointName> = (Present<RequestInput<N>['params']> extends true
  ? { params: RequestInput<N>['params'] }
  : unknown) &
  (Present<RequestInput<N>['query']> extends true
    ? { query?: RequestInput<N>['query'] }
    : unknown) &
  (Present<RequestInput<N>['body']> extends true ? { body: RequestInput<N>['body'] } : unknown);

/** The event stream of `tutor.sendMessage`. Iterate it with `for await`. */
export interface TutorStream extends AsyncIterable<TutorStreamEvent> {
  /** Stops reading and closes the connection. */
  cancel(): void;
}

/** What one call resolves to: the parsed JSON, nothing for 204, or the stream. */
export type ApiResult<N extends EndpointName> = Meta[N]['stream'] extends true
  ? TutorStream
  : Meta[N]['status'] extends 204
    ? undefined
    : ResponseOf<N>;

export interface CallOptions {
  signal?: AbortSignal;
  /**
   * Fail with a local 401 instead of sending the call without a token when nobody is signed in
   * (the outbox: a write must never go out without its learner's login).
   */
  requireLogin?: boolean;
}

export type ApiArgs<N extends EndpointName> =
  object extends ApiInput<N>
    ? [input?: ApiInput<N>, options?: CallOptions]
    : [input: ApiInput<N>, options?: CallOptions];

export type EndpointFn<N extends EndpointName> = (...args: ApiArgs<N>) => Promise<ApiResult<N>>;

type Namespace<N> = N extends `${infer A}.${string}` ? A : never;
type Action<N, A extends string> = N extends `${A}.${infer B}` ? B : never;

/** `api.review.queue(...)`, `api.tutor.sendMessage(...)`, one per endpoint name. */
export type ApiFunctions = {
  [A in Namespace<EndpointName>]: {
    [B in Action<EndpointName, A>]: EndpointFn<`${A}.${B}` & EndpointName>;
  };
};

export interface ApiClient extends ApiFunctions {
  /** Calls an endpoint by name. The outbox uses this. */
  call<N extends EndpointName>(name: N, ...args: ApiArgs<N>): Promise<ApiResult<N>>;
  /** Builds the full URL of a call (base, path and query). */
  url<N extends EndpointName>(name: N, input?: ApiInput<N>): string;
}

export interface ApiClientOptions {
  /** Base path or URL, default `/api/v1`. */
  base?: string;
  /**
   * The current access token, or null when signed out. Undefined means no login is wired (tests,
   * tools): then `requireLogin` does not apply.
   */
  getToken?: () => Promise<string | null | undefined> | string | null | undefined;
  /** Called once on a 401. Return true when the token was refreshed, and the call is repeated. */
  onUnauthorized?: () => Promise<boolean>;
  /** Called with every JSON response; dev mode validates it against the contract here. */
  onResponse?: (name: EndpointName, data: unknown) => void;
  fetch?: typeof fetch;
}

type AnyInput = {
  params?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
};

function fillPath(path: string, params: Record<string, string | number> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`missing path parameter "${k}" for ${path}`);
    return encodeURIComponent(String(v));
  });
}

function queryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) qs.append(k, String(x));
    else qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

function origin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin && loc.origin !== 'null' ? loc.origin : 'http://localhost';
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const base = (options.base ?? '/api/v1').replace(/\/$/, '');
  const doFetch: typeof fetch = (...a) => (options.fetch ?? globalThis.fetch)(...a);

  function url(name: EndpointName, input?: AnyInput): string {
    const meta = ENDPOINT_META[name];
    const rel = `${base}${fillPath(meta.path, input?.params)}${queryString(input?.query)}`;
    return new URL(rel, origin()).toString();
  }

  async function send(
    name: EndpointName,
    input: AnyInput | undefined,
    opts: CallOptions | undefined,
    retried: boolean,
  ): Promise<Response> {
    const meta = ENDPOINT_META[name];
    const headers: Record<string, string> = {
      Accept: meta.stream ? 'text/event-stream' : 'application/json',
    };
    if (meta.auth && options.getToken) {
      const token = await options.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      else if (token === null && opts?.requireLogin)
        throw new ApiError(401, 'unauthorized', 'Not signed in.');
    }
    const init: RequestInit = { method: meta.method, headers };
    if (input?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(input.body);
    }
    if (opts?.signal) init.signal = opts.signal;
    let res: Response;
    try {
      res = await doFetch(url(name, input), init);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') throw e;
      throw ApiError.network(e);
    }
    if (res.status === 401 && meta.auth && !retried && options.onUnauthorized) {
      if (await options.onUnauthorized()) return send(name, input, opts, true);
    }
    if (!res.ok) throw await ApiError.fromResponse(res);
    return res;
  }

  async function call(name: EndpointName, input?: AnyInput, opts?: CallOptions): Promise<unknown> {
    const meta = ENDPOINT_META[name];
    if (!meta) throw new Error(`unknown endpoint "${name}"`);
    const res = await send(name, input, opts, false);
    if (meta.stream) {
      const body = res.body;
      if (!body) throw ApiError.network(new Error('empty stream'));
      const controller = new AbortController();
      const signal = opts?.signal
        ? AbortSignal.any([opts.signal, controller.signal])
        : controller.signal;
      const stream: TutorStream = {
        [Symbol.asyncIterator]: () => readTutorStream(body, signal),
        cancel: () => {
          controller.abort();
          body.cancel().catch(() => {});
        },
      };
      return stream;
    }
    if (res.status === 204) return undefined;
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      throw new ApiError(res.status, 'internal', 'The server sent an unreadable answer.', {
        cause: String(e),
      });
    }
    options.onResponse?.(name, data);
    return data;
  }

  const client: Record<string, unknown> = {
    call: (name: EndpointName, input?: AnyInput, opts?: CallOptions) => call(name, input, opts),
    url: (name: EndpointName, input?: AnyInput) => url(name, input),
  };
  for (const name of Object.keys(ENDPOINT_META) as EndpointName[]) {
    const [ns, action] = name.split('.') as [string, string];
    client[ns] ??= {};
    const group = client[ns] as Record<string, unknown>;
    group[action] = (input?: AnyInput, opts?: CallOptions) => call(name, input, opts);
  }
  return client as unknown as ApiClient;
}
