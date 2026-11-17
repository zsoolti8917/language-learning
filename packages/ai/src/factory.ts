// createGateway: the one way the app gets a gateway. It returns the mock until B8 adds the
// real gateway for `mode: 'anthropic'`; the config and the types stay as they are.
import type { AiRoute } from '@app/contracts';
import { PROMPTS } from '../prompts';
import { createMockGateway, type MockGateway, type Responder } from './mock';
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

export function createGateway(config: GatewayConfig): AiGateway {
  // B8: return the real gateway here when config.mode === 'anthropic'.
  return createConfiguredMock(config);
}
