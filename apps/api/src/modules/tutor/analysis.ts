// Step 2 of a tutor turn: the route `tutor.analyze` reads the learner's message and returns
// its errors (docs/contracts.md, "Tutor stream", TutorAnalysis). B9 owns this schema.
// The evals (I3) call `analyzeMessage` and `normalizeAnalysis` directly.
import { CaseSchema, ErrorTypeSchema } from '@app/contracts';
import { z } from 'zod';
import type { AiGateway, Usage } from '../../ports';
import { analyzeRequest, type TurnContext } from './prompts';

export const AnalysisErrorSchema = z.object({
  start: z.int().nonnegative(),
  end: z.int().nonnegative(),
  given: z.string().min(1),
  expected: z.string().min(1),
  correctedSentence: z.string(),
  /** Not in the contract's type: an English translation for the case sentence card. */
  correctedSentenceEn: z.string().optional(),
  errorType: ErrorTypeSchema,
  lemma: z.string().optional(),
  caseExpected: CaseSchema.optional(),
  caseGiven: CaseSchema.optional(),
  trigger: z.string().optional(),
  explanationEn: z.string(),
});
export type AnalysisError = z.infer<typeof AnalysisErrorSchema>;

export const TutorAnalysisSchema = z.object({
  errors: z.array(AnalysisErrorSchema).max(30),
  /** Earlier prompted errors the learner answered. */
  retries: z.array(z.object({ errorId: z.string(), fixed: z.boolean() })),
  goalUpdates: z.array(z.object({ criterionId: z.string(), met: z.boolean() })),
  /** False when the message cannot be understood. */
  meaningOk: z.boolean(),
});
export type TutorAnalysis = z.infer<typeof TutorAnalysisSchema>;

export const ANALYZE_MAX_TOKENS = 2000;

/** Calls `tutor.analyze` and cleans the answer against the message. No transaction may be open. */
export async function analyzeMessage(
  ai: AiGateway,
  userId: string,
  ctx: TurnContext,
): Promise<{ analysis: TutorAnalysis; usage: Usage }> {
  const { data, usage } = await ai.structured({
    ...analyzeRequest(ctx),
    userId,
    schema: TutorAnalysisSchema,
    maxTokens: ANALYZE_MAX_TOKENS,
  });
  return { analysis: normalizeAnalysis(ctx.message, data, ctx), usage };
}

/** Every start of `needle` in `text`. */
function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/**
 * Makes the model's answer safe to use:
 * - each span is moved to where `given` really is (the nearest occurrence), and an error whose
 *   `given` is not in the message at all is dropped;
 * - overlapping errors keep the first one;
 * - retries name only open errors (once each), goal updates only known criteria.
 */
export function normalizeAnalysis(
  message: string,
  analysis: TutorAnalysis,
  known: { openErrors: { id: string }[]; criteria: { id: string }[] },
): TutorAnalysis {
  const errors: AnalysisError[] = [];
  const sorted = [...analysis.errors].sort((a, b) => a.start - b.start);
  for (const e of sorted) {
    let start = e.start;
    if (message.slice(e.start, e.end) !== e.given) {
      const found = occurrences(message, e.given);
      if (found.length === 0) continue;
      start = found.reduce((best, i) =>
        Math.abs(i - e.start) < Math.abs(best - e.start) ? i : best,
      );
    }
    const end = start + e.given.length;
    if (errors.some((x) => start < x.end && x.start < end)) continue;
    errors.push({ ...e, start, end });
  }
  errors.sort((a, b) => a.start - b.start);

  const open = new Set(known.openErrors.map((e) => e.id));
  const seen = new Set<string>();
  const retries = analysis.retries.filter((r) => {
    if (!open.has(r.errorId) || seen.has(r.errorId)) return false;
    seen.add(r.errorId);
    return true;
  });
  const criteria = new Set(known.criteria.map((c) => c.id));
  const goalUpdates = analysis.goalUpdates.filter((g) => criteria.has(g.criterionId));
  return { errors, retries, goalUpdates, meaningOk: analysis.meaningOk };
}
