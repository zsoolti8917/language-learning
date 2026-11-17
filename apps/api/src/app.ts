// The Hono app: middleware, error mapping and the routes of every module.
import { LIMITS } from '@app/contracts';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';
import { routes as analyzerRoutes } from './modules/analyzer/routes';
import { routes as declensionRoutes } from './modules/declension/routes';
import { routes as lexiconRoutes } from './modules/lexicon/routes';
import { routes as notesRoutes } from './modules/notes/routes';
import { routes as placementRoutes } from './modules/placement/routes';
import { routes as profileRoutes } from './modules/profile/routes';
import { routes as readerRoutes } from './modules/reader/routes';
import { routes as reportsRoutes } from './modules/reports/routes';
import { routes as reviewRoutes } from './modules/review/routes';
import { routes as systemRoutes } from './modules/system/routes';
import { routes as tutorRoutes } from './modules/tutor/routes';
import { routes as wordsRoutes } from './modules/words/routes';
import type { AppDeps } from './platform/deps';
import { ApiError, errorBody, notFound, toApiError } from './platform/errors';
import { mountRoutes, type RouteDef } from './platform/route';

/** Every module's routes. Each module owns its own list in `modules/<m>/routes.ts`. */
export const MODULE_ROUTES: Readonly<Record<string, readonly RouteDef[]>> = {
  system: systemRoutes,
  profile: profileRoutes,
  review: reviewRoutes,
  notes: notesRoutes,
  lexicon: lexiconRoutes,
  analyzer: analyzerRoutes,
  words: wordsRoutes,
  placement: placementRoutes,
  reader: readerRoutes,
  declension: declensionRoutes,
  tutor: tutorRoutes,
  reports: reportsRoutes,
};

export type App = Hono<{ Variables: { requestId: string } }>;

/** Builds the app on `deps`. `routes` defaults to every module's routes (tests may swap them). */
export function createApp(
  deps: AppDeps,
  routes: Readonly<Record<string, readonly RouteDef[]>> = MODULE_ROUTES,
): App {
  const app: App = new Hono();

  app.use(requestId());
  app.use(
    bodyLimit({
      maxSize: LIMITS.requestBodyBytes,
      onError: () => {
        throw new ApiError('validation_failed', 'The request body is too large.', {
          fields: { body: `At most ${LIMITS.requestBodyBytes} bytes.` },
        });
      },
    }),
  );

  app.onError((err, c) => {
    const e = toApiError(err);
    if (e.code === 'internal' && !(err instanceof ApiError))
      console.error(`[${c.get('requestId')}] ${c.req.method} ${c.req.path}`, err);
    return c.json(errorBody(e), e.status as 500);
  });
  app.notFound((c) => {
    const e = notFound('No such endpoint.');
    return c.json(errorBody(e), 404);
  });

  for (const list of Object.values(routes)) mountRoutes(app, list, deps);
  return app;
}
