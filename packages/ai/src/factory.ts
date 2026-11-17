// createGateway: the one way the app gets a gateway. `mode: 'anthropic'` gives the real
// gateway (B8), anything else the mock with the local mode answers of the prompt folders.
import type { AiRoute } from '@app/contracts';
import { PROMPTS } from '../prompts';
import { type AnthropicGatewayOptions, createAnthropicGateway } from './anthropic';
import { createMockGateway, type MockGateway, type Responder } from './mock';
import { routeOverridesFromEnv } from './routes';
import type { AiGateway, GatewayConfig } from './types';

/** The mock answers that the prompt folders define, for local mode. */
export function promptMockDefaults(): Partial<Record<AiRoute, Responder>> {
  const out: Partial<Record<AiRoute, Responder>> = {};
  for (const folder of Object.values(PROMPTS)) if (folder.mock) out[folder.route] = folder.mock;
  return out;
}

/** A mock gateway with the budget check, usage rows and local mode answers of `config`. */
export function createConfiguredMock(config: GatewayConfig): MockGateway {
  return createMockGateway({ ...config, defaults: promptMockDefaults() });
}

/**
 * The gateway of a config. In `anthropic` mode the effort, token limit and timeout overrides
 * come from `opts.routes`, or else from `AI_EFFORT_<ROUTE>`, `AI_MAX_TOKENS_<ROUTE>` and
 * `AI_TIMEOUT_MS_<ROUTE>` in `process.env` (the API's config carries only the models).
 */
export function createGateway(
  config: GatewayConfig,
  opts: AnthropicGatewayOptions = {},
): AiGateway {
  if (config.mode !== 'anthropic') return createConfiguredMock(config);
  const routes = opts.routes ?? routeOverridesFromEnv(globalThis.process?.env ?? {});
  return createAnthropicGateway(config, { ...opts, routes });
}
