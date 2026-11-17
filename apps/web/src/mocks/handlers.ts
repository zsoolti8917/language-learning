// The mock server: one default handler per endpoint that replays the contract example.
// Features add or override handlers in features/<feature>/mocks.ts (`export const handlers`),
// which come first, so they win. Tests override per test with `server.use(...)`.
//
// The helpers live in ./endpoint (no glob there). A feature's mocks.ts must import them from
// '../../mocks/endpoint', never from this file: this file loads every features/*/mocks.ts
// eagerly, so importing it back from one of them is an import cycle.
import type { HttpHandler } from 'msw';
import { defaultHandlers } from './endpoint';

export * from './endpoint';

const featureModules = import.meta.glob<{ handlers?: HttpHandler[] }>('../features/*/mocks.ts', {
  eager: true,
});

/** Handlers the features export from features/<feature>/mocks.ts. */
export const featureHandlers: HttpHandler[] = Object.keys(featureModules)
  .sort()
  .flatMap((k) => featureModules[k]?.handlers ?? []);

/** Feature handlers first (they override), then the defaults. */
export const handlers: HttpHandler[] = [...featureHandlers, ...defaultHandlers];
