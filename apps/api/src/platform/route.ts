// The route helper: binds a handler to an endpoint of the contract table. It checks the
// token, validates path, query and body before the handler runs, and validates the response
// in tests and in local mode.
import {
  API_BASE,
  type EndpointDef,
  type EndpointName,
  endpoints,
  type RequestOutput,
  type ResponseOf,
} from '@app/contracts';
import type { Tx } from '@app/db';
import type { Context, Env, Hono } from 'hono';
import type { Ports } from '../ports';
import { bearerToken } from './auth';
import type { AppDeps } from './deps';
import { ApiError, fieldsOf, unauthorized, validationFailed } from './errors';

export interface HandlerContext<N extends EndpointName> {
  readonly name: N;
  /** Validated path parameters (coerced by the schema). */
  readonly params: RequestOutput<N>['params'];
  /** Validated query (defaults filled, e.g. `limit` 50). */
  readonly query: RequestOutput<N>['query'];
  /** Validated body (unknown keys stripped). */
  readonly body: RequestOutput<N>['body'];
  /** The signed in learner. Reading it on the public health endpoint throws. */
  readonly userId: string;
  readonly deps: AppDeps;
  readonly ports: Ports;
  /** A transaction as this learner; row level security applies. Make no network call inside. */
  withUser<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Aborted when the client goes away. */
  readonly signal: AbortSignal;
  /** The raw Hono context, for headers and streams. */
  readonly c: Context;
}

/**
 * A handler returns the response body (status from the endpoint table), nothing for 204, or
 * a ready Response (the event stream).
 */
export type HandlerResult<N extends EndpointName> = [ResponseOf<N>] extends [never]
  ? Response | undefined
  : ResponseOf<N> | Response;

export type Handler<N extends EndpointName> = (
  ctx: HandlerContext<N>,
) => HandlerResult<N> | Promise<HandlerResult<N>>;

export interface RouteDef {
  readonly name: EndpointName;
  // biome-ignore lint/suspicious/noExplicitAny: a list holds handlers of every endpoint
  readonly handler: Handler<any>;
}

export function route<N extends EndpointName>(name: N, handler: Handler<N>): RouteDef {
  return { name, handler };
}

async function readBody(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw validationFailed({ body: 'Malformed JSON.' });
  }
}

function validate(where: string, schema: EndpointDef['body'], value: unknown): unknown {
  if (!schema) return undefined;
  const r = schema.safeParse(value);
  if (!r.success) throw validationFailed(fieldsOf(where, r.error));
  return r.data;
}

/** Registers every route on `app` under API_BASE. */
export function mountRoutes<E extends Env>(
  app: Hono<E>,
  routes: readonly RouteDef[],
  deps: AppDeps,
): void {
  for (const r of routes) {
    const ep = endpoints[r.name] as EndpointDef;
    app.on(ep.method, `${API_BASE}${ep.path}`, async (c) => {
      let userId: string | null = null;
      if (ep.auth) {
        const token = bearerToken(c.req.header('authorization'));
        if (!token) throw unauthorized();
        userId = await deps.auth.verify(token);
        await deps.profiles.ensure(userId);
      }
      // Validate all three parts so `details.fields` names every wrong field at once.
      const fields: Record<string, string> = {};
      const take = (where: string, schema: EndpointDef['body'], value: unknown) => {
        try {
          return validate(where, schema, value);
        } catch (e) {
          if (e instanceof ApiError && e.details?.fields)
            Object.assign(fields, e.details.fields as Record<string, string>);
          else throw e;
          return undefined;
        }
      };
      const params = take('params', ep.params, c.req.param());
      const query = take('query', ep.query, c.req.query());
      const body = ep.body ? take('body', ep.body, await readBody(c)) : undefined;
      if (Object.keys(fields).length > 0) throw validationFailed(fields);

      const uid = userId;
      const ctx: HandlerContext<EndpointName> = {
        name: r.name,
        params: params as never,
        query: query as never,
        body: body as never,
        get userId(): string {
          if (!uid) throw new Error(`${r.name} has no signed in learner`);
          return uid;
        },
        deps,
        ports: deps.ports,
        withUser: (fn) => {
          if (!uid) throw new Error(`${r.name} has no signed in learner`);
          return deps.database.withUser(uid, fn);
        },
        signal: c.req.raw.signal,
        c,
      };
      const result: unknown = await r.handler(ctx);
      if (result instanceof Response) return result;
      if (ep.status === 204) return c.body(null, 204);
      if (deps.config.validateResponses && ep.response) {
        const check = ep.response.safeParse(result);
        if (!check.success)
          throw new ApiError('internal', `The response of ${r.name} does not match the contract.`, {
            fields: fieldsOf('response', check.error),
          });
      }
      return c.json(result as object, ep.status);
    });
  }
}
