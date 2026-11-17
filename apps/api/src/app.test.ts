// The contract test: every endpoint answers as a dev user, and every response parses with
// its schema. Plus the platform's middleware: token, validation, errors, profile creation.
import {
  defaultExample,
  ENDPOINT_COUNT,
  type EndpointName,
  ErrorResponseSchema,
  endpointList,
  LIMITS,
} from '@app/contracts';
import { profile } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODULE_ROUTES } from './app';
import { route } from './platform/route';
import { parseSse } from './platform/sse';
import { createTestApp, type TestApp } from './testing/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('route registry', () => {
  it('registers each of the 45 endpoints exactly once', () => {
    const names = Object.values(MODULE_ROUTES).flatMap((r) => r.map((x) => x.name));
    expect(names).toHaveLength(ENDPOINT_COUNT);
    expect(new Set(names).size).toBe(ENDPOINT_COUNT);
    expect([...names].sort()).toEqual(endpointList.map((e) => e.name).sort());
  });

  it('gives every module folder routes, service and repo files', async () => {
    for (const m of Object.keys(MODULE_ROUTES)) {
      await import(`./modules/${m}/service.ts`);
      await import(`./modules/${m}/repo.ts`);
    }
  });
});

describe('contract test: every endpoint as a dev user', () => {
  for (const ep of endpointList) {
    const name = ep.name as EndpointName;
    it(`${ep.method} ${ep.path} (${name})`, async () => {
      const ex = defaultExample(name);
      const res = await t.as().call(name, ex.request as never);
      // A real module answers "not found" (or "conflict") for an example id that a fresh
      // learner does not own. That is correct behaviour; the answer must still be the
      // error shape. Full flows with real rows are covered by each module and by I1.
      if (ep.path.includes(':') && (res.status === 404 || res.status === 409)) {
        ErrorResponseSchema.parse(res.body);
        return;
      }
      expect(res.status, res.text).toBe(ep.status);
      if (ep.stream) {
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const events = parseSse(res.text);
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) ep.stream.parse({ event: e.event, data: e.data });
      } else if (ep.response) {
        ep.response.parse(res.body);
      } else {
        expect(res.text).toBe('');
      }
    });
  }
});

describe('health', () => {
  it('reports the version and the content version without a token', async () => {
    const res = await t.anon.get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: '0.1.0', contentVersion: '2026-11-17.1' });
  });
});

describe('token check', () => {
  it('answers 401 in the error shape without a token', async () => {
    for (const path of ['/me', '/review/queue', '/tutor/scenarios']) {
      const res = await t.anon.get(path);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'unauthorized', message: 'Sign in again.' } });
    }
  });

  it('answers 401 for a malformed dev token and for a Supabase style token in dev mode', async () => {
    for (const token of ['dev:not-a-uuid', 'eyJhbGciOiJIUzI1NiJ9.e30.x', 'dev:']) {
      const res = await t.anon.request('GET', '/me', undefined, {
        authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    }
  });

  it('creates the profile row on a learner first call, once', async () => {
    const me = t.as();
    const id = me.id as string;
    const count = async () =>
      (await t.db.db.select().from(profile).where(eq(profile.userId, id))).length;
    expect(await count()).toBe(0);
    await me.get('/me');
    await me.get('/today');
    expect(await count()).toBe(1);
    const [row] = await t.db.db.select().from(profile).where(eq(profile.userId, id));
    expect(row).toMatchObject({ timezone: 'Europe/Bratislava', dayStartHour: 4 });
  });
});

describe('validation', () => {
  it('answers 400 validation_failed and names the fields of an invalid body', async () => {
    const res = await t.as().patch('/me', { dayStartHour: 25, level: 'Z9' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual([
      'body.dayStartHour',
      'body.level',
    ]);
  });

  it('names path and query fields', async () => {
    const res = await t.as().get('/notes/not-a-uuid');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fields)).toEqual(['params.id']);
    const q = await t.as().get('/review/queue?limit=1000');
    expect(Object.keys(q.body.error.details.fields)).toEqual(['query.limit']);
  });

  it('answers 400 for malformed JSON and for a missing body', async () => {
    const bad = await t.as().post('/review/answers', '{"clientId":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toEqual({ body: 'Malformed JSON.' });
    const none = await t.as().post('/review/answers');
    expect(none.status).toBe(400);
  });

  it('refuses a body over 256 KB', async () => {
    const big = JSON.stringify({ title: 'x', body: 'a'.repeat(LIMITS.requestBodyBytes + 10) });
    const res = await t.as().request('POST', '/texts', big, {
      'content-length': String(big.length),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('checks auth before validation', async () => {
    const res = await t.anon.patch('/me', { dayStartHour: 99 });
    expect(res.status).toBe(401);
  });
});

describe('errors', () => {
  it('answers 404 not_found for an unknown path', async () => {
    const res = await t.as().get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('maps thrown errors to the error shape, and checks responses in local mode', async () => {
    const { AiGatewayError } = await import('@app/ai');
    const { ApiError } = await import('./platform/errors');
    const { createApp } = await import('./app');
    const app = createApp(t.deps, {
      test: [
        route('reports.create', () => {
          throw new ApiError('conflict', 'Taken.', { id: 'x' });
        }),
        route('tutor.scenarios', () => {
          throw new AiGatewayError('budget_exceeded', 'used up', {
            resetsAt: '2026-11-18T03:00:00.000Z',
          });
        }),
        route('words.bands', () => {
          throw new AiGatewayError('refused', 'no');
        }),
        route('library.list', () => {
          throw new Error('database password is hunter2');
        }),
        route('declension.course', () => ({ items: 'wrong' }) as never),
      ],
    });
    const id = '0195f3a0-0000-7000-8000-0000000000aa';
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(`http://test/api/v1${path}`, {
        method,
        headers: { authorization: `Bearer dev:${id}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: (await res.json()) as { error: Record<string, unknown> } };
    };
    const report = defaultExample('reports.create').request.body;
    expect(await call('POST', '/reports', report)).toEqual({
      status: 409,
      body: { error: { code: 'conflict', message: 'Taken.', details: { id: 'x' } } },
    });
    const budget = await call('GET', '/tutor/scenarios');
    expect(budget.status).toBe(429);
    expect(budget.body.error).toMatchObject({
      code: 'budget_exceeded',
      details: { resetsAt: '2026-11-18T03:00:00.000Z' },
    });
    const refused = await call('GET', '/words/bands');
    expect(refused.status).toBe(502);
    expect(refused.body.error.code).toBe('upstream_failed');
    const original = console.error;
    console.error = () => {};
    const internal = await call('GET', '/library').finally(() => {
      console.error = original;
    });
    expect(internal).toEqual({
      status: 500,
      body: { error: { code: 'internal', message: 'Something went wrong.' } },
    });
    const wrong = await call('GET', '/declension/course');
    expect(wrong.status).toBe(500);
    expect(wrong.body.error.message).toContain('does not match the contract');
  });
});

describe('test database', () => {
  it('createTestDb({ content: "mini" }) loads the mini dataset', async () => {
    const rows = await t.db.db.execute(sql`select count(*)::int as n from ling.lemma`);
    const n = Array.isArray(rows) ? rows[0].n : (rows as { rows: { n: number }[] }).rows[0]?.n;
    expect(n).toBe(72);
  });
});
