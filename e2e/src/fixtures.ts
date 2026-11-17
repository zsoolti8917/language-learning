// The test fixture of every flow:
//   learner  a new learner per test (dev login with a fresh id), so tests never share rows
//   page     signed in as that learner; every API answer it receives is checked against the
//            contracts, and console errors, page errors and 5xx answers fail the test
//   api      the same learner's direct API client, for setup and checks (also validated)
import { randomBytes } from 'node:crypto';
import {
  buildPath,
  type EndpointDef,
  type EndpointName,
  endpoints,
  type RequestInput,
  type ResponseOf,
} from '@app/contracts';
import { type APIResponse, test as base, expect, type Page } from '@playwright/test';
import { checkResponse } from './contract';

/** The API's own address (the web server proxies `/api` to it). */
export const API_URL = `http://localhost:${process.env.E2E_API_PORT ?? 8797}`;

/** UUID version 7, as the client makes them. */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = 0x70 | ((b[6] ?? 0) & 0x0f);
  b[8] = 0x80 | ((b[8] ?? 0) & 0x3f);
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface Learner {
  id: string;
  token: string;
}

type CallInput<N extends EndpointName> = Partial<RequestInput<N>>;

export interface ApiClient {
  /** Calls an endpoint as the learner; fails the test when the answer breaks the contract. */
  call<N extends EndpointName>(
    name: N,
    input?: CallInput<N>,
  ): Promise<{ status: number; body: ResponseOf<N>; text: string }>;
  /** Like `call`, without the contract check of a success (for error answers). */
  raw<N extends EndpointName>(name: N, input?: CallInput<N>): Promise<APIResponse>;
}

/** Problems seen by the page: contract drift, console errors, 5xx answers. */
export interface Watch {
  drift: string[];
  consoleErrors: string[];
  serverErrors: string[];
  /** Every API answer checked so far, as `METHOD /path status`. */
  checked: string[];
  /** Console errors a test expects (e.g. a failed request it provoked), matched by text. */
  allow(pattern: RegExp): void;
}

function watchPage(page: Page): { watch: Watch; settle: () => Promise<void> } {
  const pending: Promise<void>[] = [];
  const allowed: RegExp[] = [];
  const watch: Watch = {
    drift: [],
    consoleErrors: [],
    serverErrors: [],
    checked: [],
    allow: (p) => {
      allowed.push(p);
    },
  };
  page.on('console', (msg) => {
    // A failed request logs only its status; the location names the address.
    if (msg.type() === 'error')
      watch.consoleErrors.push(
        msg.location().url ? `${msg.text()} (${msg.location().url})` : msg.text(),
      );
  });
  page.on('pageerror', (err) => watch.consoleErrors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/')) return;
    const req = res.request();
    const status = res.status();
    if (status >= 500) watch.serverErrors.push(`${req.method()} ${url.pathname} → ${status}`);
    pending.push(
      res
        .text()
        .then((text) => {
          watch.checked.push(`${req.method()} ${url.pathname} ${status}`);
          watch.drift.push(
            ...checkResponse(
              req.method(),
              url.pathname,
              status,
              res.headers()['content-type'] ?? '',
              text,
            ),
          );
        })
        // The page navigated away or closed before the body arrived: nothing to check.
        .catch(() => undefined),
    );
  });
  return {
    watch,
    settle: async () => {
      await Promise.all(pending);
      const keep = (e: string) => !allowed.some((p) => p.test(e));
      watch.consoleErrors = watch.consoleErrors.filter(keep);
    },
  };
}

export const test = base.extend<{ learner: Learner; api: ApiClient; watch: Watch }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixture's dependencies from this pattern.
  learner: async ({}, use) => {
    const id = uuidv7();
    await use({ id, token: `dev:${id}` });
  },

  api: async ({ playwright, learner }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { authorization: `Bearer ${learner.token}` },
      timeout: 60_000,
    });
    const send = async (name: EndpointName, input: CallInput<EndpointName> = {}) => {
      const def = endpoints[name];
      const params = (input.params ?? {}) as Record<string, string | number>;
      const url = `/api/v1${buildPath(def.path, params)}`;
      const query = input.query as Record<string, string | number | boolean> | undefined;
      return ctx.fetch(url, {
        method: def.method,
        ...(query ? { params: query } : {}),
        ...(input.body !== undefined ? { data: input.body } : {}),
      });
    };
    const client: ApiClient = {
      async call(name, input) {
        const res = await send(name, input as CallInput<EndpointName>);
        const text = await res.text();
        const path = new URL(res.url()).pathname;
        const problems = checkResponse(
          endpoints[name].method,
          path,
          res.status(),
          res.headers()['content-type'] ?? '',
          text,
        );
        expect(problems, `${name} answered outside its contract`).toEqual([]);
        expect(res.status(), `${name}: ${text.slice(0, 300)}`).toBeLessThan(400);
        const def = endpoints[name] as EndpointDef;
        const body = text && !def.stream ? JSON.parse(text) : undefined;
        return { status: res.status(), body, text };
      },
      raw: (name, input) => send(name, input as CallInput<EndpointName>),
    };
    await use(client);
    await ctx.dispose();
  },

  watch: [
    async ({ page }, use) => {
      const { watch, settle } = watchPage(page);
      await use(watch);
      await settle();
      expect(watch.drift, 'API answers outside their contract').toEqual([]);
      expect(watch.serverErrors, 'API answers with status 5xx').toEqual([]);
      expect(watch.consoleErrors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],

  page: async ({ page, learner }, use) => {
    // Signed in through the dev login, which keeps its session in localStorage.
    await page.addInitScript((l) => {
      if (localStorage.getItem('app.devSession') === null)
        localStorage.setItem(
          'app.devSession',
          JSON.stringify({
            userId: l.id,
            email: 'learner@example.test',
            accessToken: l.token,
            expiresAt: null,
          }),
        );
    }, learner);
    await use(page);
  },
});

export { expect };

/** The page never scrolls sideways at 390 px. */
export async function noSidewaysScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** A learner who finished onboarding and placement, straight through the API. */
export async function onboard(api: ApiClient, name = 'Ema'): Promise<void> {
  const me = await api.call('profile.get');
  await api.call('profile.update', {
    body: {
      displayName: name,
      settings: { ...me.body.settings, onboardedAt: new Date().toISOString() },
    },
  });
}
