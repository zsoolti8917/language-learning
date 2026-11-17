// Step 4 of a tutor turn: the decision table (docs/architecture.md, "One tutor turn").
// Pure: no database, no model. It turns verified errors and the learner's retries into
// statuses, attempts to log, cards to make and the directive for `tutor.reply`.
import type { Case, TutorErrorStatus } from '@app/contracts';
import type { ReplyDirective, TurnContext } from './prompts';
import type { ErrorTarget, TriggerInfo, VerifiedError } from './verify';

/** At most this many errors are prompted in one message. */
export const MAX_PROMPTS = 2;
/** Turns of one conversation. */
export const MAX_TURNS = 40;

/** A prompted error of the last tutor message, waiting for the learner's retry. */
export interface OpenError {
  id: string;
  messageId: string;
  given: string;
  expected: string;
  caseExpected: Case | null;
  lemmaId: number | null;
  triggerId: string | null;
  explanationEn: string | null;
  /** Re-derived from the morphology data between the transactions. */
  target?: ErrorTarget | undefined;
}

export interface NewErrorDecision {
  error: VerifiedError;
  status: Extract<TutorErrorStatus, 'prompted' | 'summary_only'>;
}

export interface Resolution {
  error: OpenError;
  status: Extract<TutorErrorStatus, 'self_corrected' | 'corrected'>;
  /** How the server knew: the model's retry report, the form in the text, or no retry. */
  by: 'model' | 'text' | 'repeated' | 'not_tried';
}

export interface TurnDecision {
  newErrors: NewErrorDecision[];
  resolutions: Resolution[];
  criteriaMet: string[];
  directive: ReplyDirective;
}

const lower = (s: string) => s.normalize('NFC').toLowerCase();

/** True when `form` appears in `text` as whole words. */
export function containsForm(text: string, form: string): boolean {
  const f = lower(form).trim();
  if (!f) return false;
  const t = lower(text);
  for (let i = t.indexOf(f); i >= 0; i = t.indexOf(f, i + 1)) {
    const before = t[i - 1];
    const after = t[i + f.length];
    const isLetter = (c: string | undefined) => c !== undefined && /[\p{L}\p{M}]/u.test(c);
    if (!isLetter(before) && !isLetter(after)) return true;
  }
  return false;
}

const KTO: Partial<Record<Case, string>> = {
  nom: 'kto',
  gen: 'koho',
  dat: 'komu',
  acc: 'koho',
  loc: 'kom',
  ins: 'kým',
};
const CO: Partial<Record<Case, string>> = {
  nom: 'čo',
  gen: 'čoho',
  dat: 'čomu',
  acc: 'čo',
  loc: 'čom',
  ins: 'čím',
};

/** A short question that makes the learner say the phrase again: `S kým?`, `Do čoho?`. */
export function suggestQuestion(
  c: Case,
  target: ErrorTarget | undefined,
  trigger: TriggerInfo | undefined,
): string | undefined {
  const person = target?.gender === 'm_anim' || target?.pos === 'pron';
  const word = (person ? KTO : CO)[c];
  if (!word) return undefined;
  if (!trigger) return `${word[0]?.toUpperCase()}${word.slice(1)}?`;
  if (trigger.kind !== 'preposition') return undefined;
  let prep = trigger.lemma;
  if (prep === 'k' && word.startsWith('k')) prep = 'ku';
  if (prep === 's' && (word.startsWith('s') || word.startsWith('z'))) prep = 'so';
  return `${prep[0]?.toUpperCase()}${prep.slice(1)} ${word}?`;
}

export interface DecideInput {
  ctx: Pick<TurnContext, 'message' | 'criteria'>;
  meaningOk: boolean;
  retries: { errorId: string; fixed: boolean }[];
  goalUpdates: { criterionId: string; met: boolean }[];
  /** Verified errors of the new message (dropped ones removed). */
  errors: VerifiedError[];
  open: OpenError[];
  triggers: readonly TriggerInfo[];
  /** Turns before this one. */
  turnCount: number;
}

/**
 * The decision table:
 * - an open prompted error the learner fixed (by the model's report, or the expected form is in
 *   the new message) becomes `self_corrected`; one missed again, repeated, or not tried becomes
 *   `corrected` (a card follows);
 * - a new verified case error is `prompted`, at most two per message in order of position
 *   (later ones and every error of a message that cannot be understood are `summary_only`);
 * - an unverified case error and every other slip are `summary_only`.
 */
export function decideTurn(input: DecideInput): TurnDecision {
  const { ctx, open } = input;
  const errors = [...input.errors].sort((a, b) => a.start - b.start);
  const resolutions: Resolution[] = [];
  const repeats = new Set<VerifiedError>();
  for (const o of open) {
    const report = input.retries.find((r) => r.errorId === o.id);
    const answer = o.target?.answer ?? o.expected;
    const repeated = errors.find(
      (e) =>
        e.outcome === 'verified' &&
        o.lemmaId !== null &&
        e.lemmaId === o.lemmaId &&
        e.caseExpected === o.caseExpected,
    );
    if (containsForm(ctx.message, answer) && !repeated) {
      resolutions.push({ error: o, status: 'self_corrected', by: 'text' });
    } else if (report?.fixed === true && !repeated) {
      resolutions.push({ error: o, status: 'self_corrected', by: 'model' });
    } else if (repeated) {
      repeats.add(repeated);
      resolutions.push({ error: o, status: 'corrected', by: 'repeated' });
    } else {
      resolutions.push({ error: o, status: 'corrected', by: report ? 'model' : 'not_tried' });
    }
  }

  const newErrors: NewErrorDecision[] = [];
  let prompted = 0;
  for (const e of errors) {
    if (repeats.has(e)) continue;
    if (e.outcome === 'verified' && input.meaningOk && prompted < MAX_PROMPTS) {
      prompted += 1;
      newErrors.push({ error: e, status: 'prompted' });
    } else {
      newErrors.push({ error: e, status: 'summary_only' });
    }
  }

  const met = new Set(ctx.criteria.filter((c) => c.met).map((c) => c.id));
  for (const g of input.goalUpdates) if (g.met) met.add(g.criterionId);
  const criteriaMet = ctx.criteria.map((c) => c.id).filter((id) => met.has(id));
  const next = ctx.criteria.find((c) => !met.has(c.id));

  const promptedErrors = newErrors.filter((n) => n.status === 'prompted').map((n) => n.error);
  const confirm = resolutions
    .filter((r) => r.status === 'self_corrected')
    .map((r) => ({ form: r.error.target?.answer ?? r.error.expected }));
  const corrections = resolutions
    .filter((r) => r.status === 'corrected')
    .map((r) => ({
      given: r.error.given,
      expected: r.error.expected,
      reasonEn: r.error.explanationEn ?? '',
    }));
  const triggerOf = (id: string | null | undefined) => input.triggers.find((t) => t.id === id);
  const directive: ReplyDirective = {
    prompts: promptedErrors.map((e) => ({
      given: e.given,
      caseExpected: e.caseExpected as Case,
      trigger: e.trigger,
      lemma: e.target?.lemma,
      question: suggestQuestion(e.caseExpected as Case, e.target, triggerOf(e.triggerId)),
    })),
    confirm,
    corrections,
    meaningOk: input.meaningOk,
    goal: { next: next ? { id: next.id, textEn: next.textEn } : null, allMet: !next },
    allowedForms: [
      ...new Set([...confirm.map((c) => c.form), ...corrections.map((c) => c.expected)]),
    ],
    closing: input.turnCount + 1 >= MAX_TURNS - 2,
  };
  return { newErrors, resolutions, criteriaMet, directive };
}

/** Rule checks on a reply (for the evals and for logging): never leak a prompted form. */
export function checkReply(
  text: string,
  directive: ReplyDirective,
  hiddenForms: readonly string[],
): string[] {
  const issues: string[] = [];
  if (text.trim() === '') issues.push('empty');
  if (text.split(/\s+/).filter(Boolean).length > 60) issues.push('too_long');
  if (directive.prompts.length > 0 && !text.includes('?')) issues.push('no_question');
  for (const f of hiddenForms) if (containsForm(text, f)) issues.push(`leaked:${f}`);
  if (/[*_#`]/.test(text)) issues.push('markdown');
  return issues;
}
