// @app/ai: the AI gateway (first version F5, then B8). No other package imports the
// Anthropic SDK.

export { PROMPTS } from '../prompts';
export { createConfiguredMock, createGateway, promptMockDefaults } from './factory';
export {
  createMockGateway,
  type MockGateway,
  type MockGatewayOptions,
  type RecordedCall,
  type Responder,
  type ScriptedAnswer,
} from './mock';
export { currentVersion, type PromptFolder, type PromptVersion } from './prompt';
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
