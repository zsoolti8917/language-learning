// The token check with a locally made key set: valid, expired, wrong issuer, wrong
// signature, and the dev login.
import {
  type CryptoKey,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, withToken } from '../testing/app';
import { bearerToken, createDevVerifier, createSupabaseVerifier, type TokenVerifier } from './auth';
import { ApiError } from './errors';

const ISSUER = 'https://example-ref.supabase.co/auth/v1';
const USER = '0195f3a0-1111-7000-8000-000000000001';
const KID = 'key-1';

let verifier: TokenVerifier;
let sign: (
  claims: Record<string, unknown>,
  opts?: { key?: CryptoKey; exp?: string | number; iss?: string },
) => Promise<string>;

beforeAll(async () => {
  const good = await generateKeyPair('ES256');
  const other = await generateKeyPair('ES256');
  const jwk: JWK = { ...(await exportJWK(good.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  verifier = createSupabaseVerifier({ issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk] }) });
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '1h')
      .sign(opts.key ?? good.privateKey);
  signOther = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(other.privateKey);
});
let signOther: (claims: Record<string, unknown>) => Promise<string>;

async function rejects(p: Promise<unknown>): Promise<void> {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  expect((e as ApiError).code).toBe('unauthorized');
}

describe('Supabase token check', () => {
  it('accepts a valid token and returns sub', async () => {
    expect(await verifier.verify(await sign({ sub: USER, role: 'authenticated' }))).toBe(USER);
  });

  it('refuses an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    await rejects(verifier.verify(await sign({ sub: USER }, { exp: past })));
  });

  it('refuses a token of another issuer', async () => {
    await rejects(
      verifier.verify(await sign({ sub: USER }, { iss: 'https://other.supabase.co/auth/v1' })),
    );
  });

  it('refuses a token signed with another key', async () => {
    await rejects(verifier.verify(await signOther({ sub: USER })));
  });

  it('refuses a token whose sub is not a uuid, and garbage', async () => {
    await rejects(verifier.verify(await sign({ sub: 'service_role' })));
    await rejects(verifier.verify('not.a.token'));
    await rejects(verifier.verify(`dev:${USER}`));
  });
});

describe('dev login', () => {
  it('accepts dev:<uuid> only', async () => {
    const dev = createDevVerifier();
    expect(await dev.verify(`dev:${USER.toUpperCase()}`)).toBe(USER);
    await rejects(dev.verify(USER));
    await rejects(dev.verify('dev:abc'));
  });

  it('reads the bearer header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe('the app in Supabase mode', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ content: null, auth: verifier });
  });
  afterAll(() => t.close());

  it('signs in with a valid token and answers 401 otherwise', async () => {
    const ok = await withToken(t, await sign({ sub: USER })).get('/me');
    expect(ok.status).toBe(200);
    const past = Math.floor(Date.now() / 1000) - 60;
    const expired = await withToken(t, await sign({ sub: USER }, { exp: past })).get('/me');
    expect(expired.status).toBe(401);
    expect(expired.body).toEqual({ error: { code: 'unauthorized', message: 'Sign in again.' } });
    const dev = await t.as(USER).get('/me');
    expect(dev.status).toBe(401);
  });
});
