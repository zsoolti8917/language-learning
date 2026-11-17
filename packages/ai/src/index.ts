// @app/ai: the AI gateway (first version F5, then B8). No other package imports the
// Anthropic SDK.

export { PROMPTS } from '../prompts';
export {
  type AnthropicGatewayOptions,
  buildRequest,
  createAnthropicGateway,
  systemBlocks,
} from './anthropic';
export { mapSdkError, stopReasonError } from './errors';
export { createConfiguredMock, createGateway, promptMockDefaults } from './factory';
export {
  createMockGateway,
  type MockGateway,
  type MockGatewayOptions,
  type RecordedCall,
  type Responder,
  type ScriptedAnswer,
} from './mock';
export {
  costOf,
  FALLBACK_PRICE,
  type ModelPrice,
  PRICES,
  priceOf,
  type TokenCounts,
} from './pricing';
export { currentVersion, type PromptFolder, type PromptVersion } from './prompt';
export { type Recording, type RecordingGateway, recordGateway, replay } from './record';
export {
  promptFor,
  promptVersions,
  type RegisteredPrompt,
  systemFor,
  volatileValues,
} from './registry';
export {
  EFFORTS,
  type Effort,
  ROUTE_DEFAULTS,
  type RouteDefaults,
  type RouteOverrides,
  type RouteSettings,
  routeOverridesFromEnv,
  routeSettings,
} from './routes';
export { type ScriptedGateway, scriptedGateway } from './scripting';
export {
  type AiErrorCode,
  type AiGateway,
  AiGatewayError,
  type ChatMessage,
  type DailySpend,
  DEFAULT_MODEL,
  type GatewayConfig,
  isAiGatewayError,
  modelFor,
  type PromptBlock,
  type StreamRequest,
  type StructuredRequest,
  type Usage,
  type UsageFunctions,
  type UsageRow,
  usageStatusOf,
} from './types';
