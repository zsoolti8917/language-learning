// The steps of one tutor turn, for the evals (I3) and other callers that run them one by one:
//   analyzeMessage (tutor.analyze) → verifyErrors (MorphologyPort) → decideTurn → replyRequest
//   (tutor.reply) → checkReply. None of them opens a transaction.
export {
  type AnalysisError,
  AnalysisErrorSchema,
  analyzeMessage,
  normalizeAnalysis,
  type TutorAnalysis,
  TutorAnalysisSchema,
} from './analysis';
export { caseSentenceContent, tutorAttempt } from './cards';
export {
  checkReply,
  containsForm,
  decideTurn,
  MAX_PROMPTS,
  MAX_TURNS,
  suggestQuestion,
} from './decide';
export {
  analyzeRequest,
  analyzeUserMessage,
  promptVersionLabel,
  type ReplyDirective,
  renderDirective,
  replyRequest,
  type ScenarioInfo,
  scenarioBlock,
  summaryRequest,
  systemFor,
  type TurnContext,
} from './prompts';
export {
  type ErrorTarget,
  findTrigger,
  type TriggerInfo,
  type VerifiedError,
  type VerifyDeps,
  verifyError,
  verifyErrors,
} from './verify';
