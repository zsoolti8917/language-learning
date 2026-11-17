import type { EndpointName } from '@app/contracts';
import { queryOptions } from '@tanstack/react-query';
import { env } from '../env';
import {
  type ApiArgs,
  type ApiClient,
  type ApiClientOptions,
  type ApiInput,
  type ApiResult,
  createApiClient,
} from './client';

export {
  type ApiArgs,
  type ApiClient,
  type ApiClientOptions,
  type ApiInput,
  type ApiResult,
  type CallOptions,
  createApiClient,
  type EndpointFn,
  type TutorStream,
} from './client';
export { ENDPOINT_META, type EndpointMeta } from './endpoints.gen';
export { ApiError, type ApiErrorCode, isApiError } from './errors';
export { type RawSseEvent, readSse, readTutorStream, StreamFormatError } from './sse';

type Hooks = Pick<ApiClientOptions, 'getToken' | 'onUnauthorized' | 'onResponse'>;
const hooks: Hooks = {};

/** Wires the shared client to login (token, refresh) and, in dev, to response validation. */
export function configureApi(next: Hooks): void {
  Object.assign(hooks, next);
}

/** The app's one API client. Features call `api.<module>.<action>(input)`. */
export const api: ApiClient = createApiClient({
  base: env.apiBase,
  getToken: () => hooks.getToken?.() ?? null,
  onUnauthorized: () => hooks.onUnauthorized?.() ?? Promise.resolve(false),
  onResponse: (name, data) => hooks.onResponse?.(name, data),
});

/** Query key of one endpoint call: `['api', name, input]`. Invalidate with `['api', name]`. */
export function apiKey<N extends EndpointName>(name: N, input?: ApiInput<N>) {
  return ['api', name, input ?? {}] as const;
}

/**
 * TanStack Query options for a read endpoint:
 * `useQuery(apiQuery('review.queue', { query: { limit: 50 } }))`.
 */
export function apiQuery<N extends EndpointName>(name: N, ...args: ApiArgs<N>) {
  const [input] = args;
  return queryOptions({
    queryKey: apiKey(name, input as ApiInput<N> | undefined),
    queryFn: ({ signal }) =>
      (api.call as (n: N, i: unknown, o: unknown) => Promise<ApiResult<N>>)(name, input, {
        signal,
      }),
  });
}
