// createTestApp: the whole app on a test database, with stand ins, the mock gateway, a fixed
// clock and a request helper that signs in as a learner (dev login).
import { createConfiguredMock, type MockGateway } from '@app/ai';
import {
  API_BASE,
  buildPath,
  type EndpointDef,
  type EndpointName,
  endpoints,
  type RequestInput,
} from '@app/contracts';
import { createTestDb, type TestDb, uuidv7 } from '@app/testkit';
import { type App, createApp } from '../app';
import { createContainer } from '../container';
import type { TokenVerifier } from '../platform/auth';
import { createBackground } from '../platform/background';
import { createFixedClock, type FixedClock, uuidV7Ids } from '../platform/clock';
import { type Config, loadConfig } from '../platform/config';
import type { AppDeps } from '../platform/deps';
import type { IdGenerator, Ports } from '../ports';

export interface TestAppOptions {
  /** Content to load into a new test database; default the mini dataset. Ignored with `db`. */
  content?: 'mini' | (string & {}) | null;
  /** A test database to share (e.g. one per file); the test app does not close it. */
  db?: TestDb;
  /** Start of the fixed clock; default 2026-11-17T08:30:00Z. */
  now?: Date | string;
  ids?: IdGenerator;
  /** Replaces single ports (default: the stand ins of each module's port.ts). */
  ports?: Partial<Ports>;
  /** Overrides of the test config (local mode, responses validated). */
  config?: Partial<Config>;
  auth?: TokenVerifier;
}

// biome-ignore lint/suspicious/noExplicitAny: tests read error bodies and examples freely
export interface TestResponse<T = any> {
  status: number;
  headers: Headers;
  /** Parsed JSON, or the raw text for other content types (the event stream). */
  body: T;
  text: string;
}

export interface TestClient {
  /** The learner id, or null for the client without a token. */
  readonly id: string | null;
  request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse>;
  get(path: string): Promise<TestResponse>;
  post(path: string, body?: unknown): Promise<TestResponse>;
  put(path: string, body?: unknown): Promise<TestResponse>;
  patch(path: string, body?: unknown): Promise<TestResponse>;
  delete(path: string): Promise<TestResponse>;
  /** Calls an endpoint by name: path params, query and body as a client sends them. */
  call<N extends EndpointName>(name: N, input?: Partial<RequestInput<N>>): Promise<TestResponse>;
}

export interface TestApp {
  app: App;
  deps: AppDeps;
  db: TestDb;
  ports: Ports;
  gateway: MockGateway;
  clock: FixedClock;
  /** A client signed in as `id` (a new learner when omitted). Paths are below /api/v1. */
  as(id?: string): TestClient;
  /** A client without a token. */
  anon: TestClient;
  /** Waits for runInBackground work. */
  drain(): Promise<void>;
  /** Closes the database unless it was passed in. */
  close(): Promise<void>;
}

export const TEST_ENV = {
  APP_ENV: 'local',
  DB_MODE: 'pglite',
  AUTH_MODE: 'dev',
  AI_MODE: 'mock',
  VALIDATE_RESPONSES: 'true',
} as const;

export async function createTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const db =
    opts.db ??
    (await createTestDb(opts.content === null ? {} : { content: opts.content ?? 'mini' }));
  const config = { ...loadConfig(TEST_ENV), ...opts.config };
  const clock = createFixedClock(opts.now);
  let gateway: MockGateway | undefined;
  const background = createBackground();
  const deps = createContainer({
    config,
    database: db,
    clock,
    ids: opts.ids ?? uuidV7Ids,
    background,
    ...(opts.auth ? { auth: opts.auth } : {}),
    gateway: (c) => {
      gateway = createConfiguredMock(c);
      return gateway;
    },
    ...(opts.ports ? { ports: opts.ports } : {}),
  });
  const app = createApp(deps);

  function client(id: string | null, token?: string): TestClient {
    const request: TestClient['request'] = async (method, path, body, headers = {}) => {
      const h: Record<string, string> = { ...headers };
      const auth = token ?? (id ? `dev:${id}` : null);
      if (auth) h.authorization = `Bearer ${auth}`;
      let payload: string | undefined;
      if (body !== undefined) {
        h['content-type'] = 'application/json';
        payload = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const url = path.startsWith('http') ? path : `http://test${API_BASE}${path}`;
      const res = await app.request(url, { method, headers: h, body: payload });
      const text = await res.text();
      const isJson = res.headers.get('content-type')?.includes('application/json');
      return {
        status: res.status,
        headers: res.headers,
        body: isJson ? JSON.parse(text) : text,
        text,
      };
    };
    return {
      id,
      request,
      get: (p) => request('GET', p),
      post: (p, b) => request('POST', p, b),
      put: (p, b) => request('PUT', p, b),
      patch: (p, b) => request('PATCH', p, b),
      delete: (p) => request('DELETE', p),
      call(name, input = {}) {
        const ep = endpoints[name] as EndpointDef;
        let path = buildPath(ep.path, (input.params ?? {}) as Record<string, string | number>);
        const q = Object.entries((input.query ?? {}) as Record<string, unknown>).filter(
          ([, v]) => v !== undefined,
        );
        if (q.length > 0)
          path += `?${new URLSearchParams(q.map(([k, v]): [string, string] => [k, String(v)])).toString()}`;
        return request(ep.method, path, input.body);
      },
    };
  }

  return {
    app,
    deps,
    db,
    ports: deps.ports,
    get gateway(): MockGateway {
      if (!gateway) throw new Error('gateway not built');
      return gateway;
    },
    clock,
    as: (id) => client(id ?? uuidv7()),
    anon: client(null),
    drain: () => background.drain(),
    close: async () => {
      await background.drain();
      if (!opts.db) await db.close();
    },
  };
}

/** A client that sends `token` as its bearer token (for the Supabase mode tests). */
export function withToken(t: TestApp, token: string): Pick<TestClient, 'get'> {
  return {
    get: async (path) => {
      const res = await t.app.request(`http://test${API_BASE}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: JSON.parse(text), text };
    },
  };
}
