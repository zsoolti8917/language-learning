// Local mode end to end: the Node server on PGlite with the mini dataset, over real HTTP.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_PGDATA, localEnv, type RunningServer, startServer } from './server';
import vercel from './vercel';

describe('local mode server', () => {
  let dir: string;
  let server: RunningServer;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'api-local-'));
    server = await startServer(localEnv({ PGLITE_DIR: join(dir, 'pgdata') }), 0);
  });
  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses the local defaults and .local/pgdata', () => {
    expect(localEnv({})).toMatchObject({
      APP_ENV: 'local',
      DB_MODE: 'pglite',
      AUTH_MODE: 'dev',
      AI_MODE: 'mock',
      PGLITE_DIR: LOCAL_PGDATA,
    });
    expect(LOCAL_PGDATA.endsWith(join('.local', 'pgdata'))).toBe(true);
  });

  it('GET /api/v1/health reports the version and the content version', async () => {
    const res = await fetch(`${server.url}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      version: '0.1.0',
      contentVersion: '2026-11-17.1',
    });
  });

  it('signs in with the dev login and creates the profile', async () => {
    const res = await fetch(`${server.url}/api/v1/me`, {
      headers: { authorization: 'Bearer dev:0195f3a0-2222-7000-8000-000000000001' },
    });
    expect(res.status).toBe(200);
  });

  it('starts again on the same data folder (migrations and content are repeatable)', async () => {
    await server.close();
    server = await startServer(localEnv({ PGLITE_DIR: join(dir, 'pgdata') }), 0);
    const res = await fetch(`${server.url}/api/v1/health`);
    expect(((await res.json()) as { contentVersion: string }).contentVersion).toBe('2026-11-17.1');
  });
});

describe('vercel entry', () => {
  it('exports a fetch handler', () => {
    expect(typeof vercel.fetch).toBe('function');
  });
});
