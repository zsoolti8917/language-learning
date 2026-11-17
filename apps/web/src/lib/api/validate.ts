// Response validation for dev mode and tests. Loaded on demand: it pulls in zod and every
// schema, which the first load of production must not carry.
import { type EndpointName, endpoints } from '@app/contracts';

/** Parses a response with the contract schema; throws on a mismatch. Returns the parsed value. */
export function parseResponse<N extends EndpointName>(name: N, data: unknown): unknown {
  const schema = endpoints[name].response as { parse: (d: unknown) => unknown } | null;
  if (!schema) return data;
  return schema.parse(data);
}

/** Logs a response that drifts from the contract (dev mode, `onResponse`). */
export function warnOnDrift(name: EndpointName, data: unknown): void {
  const schema = endpoints[name].response as {
    safeParse: (d: unknown) => { success: boolean; error?: unknown };
  } | null;
  if (!schema) return;
  const r = schema.safeParse(data);
  if (!r.success) console.error(`[api] ${name} answered outside its contract`, r.error);
}
