// The token check in two modes: Supabase access tokens verified with the project's public
// keys (jose), or the dev login `Bearer dev:<uuid>` of local mode.
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import type { Config } from './config';
import { unauthorized } from './errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the learner's user id for a bearer token, or throws `unauthorized`. */
export interface TokenVerifier {
  readonly mode: 'supabase' | 'dev';
  verify(token: string): Promise<string>;
}

/** Local mode: `dev:<uuid>`, nothing else. */
export function createDevVerifier(): TokenVerifier {
  return {
    mode: 'dev',
    async verify(token) {
      const id = token.startsWith('dev:') ? token.slice(4) : '';
      if (!UUID_RE.test(id)) throw unauthorized();
      return id.toLowerCase();
    },
  };
}

export interface SupabaseVerifierOptions {
  /** `https://<ref>.supabase.co/auth/v1` */
  issuer: string;
  /** The key set; by default the project's JWKS at `<issuer>/.well-known/jwks.json`. */
  keys?: JWTVerifyGetKey;
  /** Default `authenticated`, the audience Supabase puts in a learner's access token. */
  audience?: string;
}

/** Real tokens: signature against the key set, issuer, audience and expiry; `sub` is the id. */
export function createSupabaseVerifier(opts: SupabaseVerifierOptions): TokenVerifier {
  const keys = opts.keys ?? createRemoteJWKSet(new URL(`${opts.issuer}/.well-known/jwks.json`));
  return {
    mode: 'supabase',
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: opts.issuer,
          audience: opts.audience ?? 'authenticated',
          requiredClaims: ['sub', 'exp'],
        });
        if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) throw unauthorized();
        return payload.sub.toLowerCase();
      } catch {
        throw unauthorized();
      }
    },
  };
}

/** The verifier the config asks for. */
export function createVerifier(config: Config): TokenVerifier {
  if (config.authMode === 'dev') {
    if (config.appEnv === 'production') throw new Error('The dev login is off in production.');
    return createDevVerifier();
  }
  if (!config.supabaseUrl) throw new Error('SUPABASE_URL is missing.');
  return createSupabaseVerifier({ issuer: `${config.supabaseUrl}/auth/v1` });
}

/** The token of an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const m = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return m?.[1] ?? null;
}
