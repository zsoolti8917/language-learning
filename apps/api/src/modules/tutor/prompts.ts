// The requests of the three tutor routes. The stable rules live in the prompt folders
// (packages/ai/prompts/tutor.*); this file adds the scenario block, which stays the same for a
// whole conversation, and the per turn user message. Block order: role and rules, checklist
// or level rules, scenario. No dates, ids of requests or random values go into the system.
import { PROMPTS } from '@app/ai';
import type { AiRoute, Case, Level, ScenarioMode } from '@app/contracts';
import type { ChatMessage, PromptBlock } from '../../ports';

export const CASE_NAMES: Record<Case, string> = {
  nom: 'nominative',
  gen: 'genitive',
  dat: 'dative',
  acc: 'accusative',
  voc: 'vocative',
  loc: 'locative',
  ins: 'instrumental',
};

export interface ScenarioInfo {
  id: string;
  mode: ScenarioMode;
  titleEn: string;
  titleSk: string;
  goalEn: string;
  settingSk: string;
  tutorRole: string;
  targetCases: Case[];
  targetTriggers: string[];
  level: Level;
  openingSk: string;
  successCriteria: { id: string; textEn: string }[];
  vocabHint: { sk: string; en: string }[];
}

export interface OpenErrorBrief {
  id: string;
  given: string;
  caseExpected?: Case | undefined;
  lemma?: string | undefined;
  trigger?: string | undefined;
}

/** What the model sees of one turn. */
export interface TurnContext {
  scenario: ScenarioInfo;
  /** Earlier messages, oldest first. */
  history: { role: 'tutor' | 'learner' | 'system_note'; content: string }[];
  /** Errors prompted in the last tutor message, waiting for the learner's retry. */
  openErrors: OpenErrorBrief[];
  criteria: { id: string; textEn: string; met: boolean }[];
  /** The learner's new message (NFC, trimmed). */
  message: string;
}

/** The server's instructions for `tutor.reply`. Prompted errors carry no expected form. */
export interface ReplyDirective {
  prompts: {
    given: string;
    caseExpected: Case;
    trigger?: string | undefined;
    lemma?: string | undefined;
    question?: string | undefined;
  }[];
  confirm: { form: string }[];
  corrections: { given: string; expected: string; reasonEn: string }[];
  meaningOk: boolean;
  goal: { next: { id: string; textEn: string } | null; allMet: boolean };
  /** The only grammatical forms the reply may mention. */
  allowedForms: string[];
  /** The conversation is close to its turn limit. */
  closing: boolean;
}

/** How many earlier messages a request carries. */
export const HISTORY_MESSAGES = 12;

/** The version of each tutor route in use, as `app.conversation.prompt_version` stores it. */
export function promptVersionLabel(): string {
  const v = (r: AiRoute) => `${r}@${PROMPTS[r].current}`;
  return [v('tutor.analyze'), v('tutor.reply'), v('tutor.summary')].join(' ');
}

function baseBlocks(route: AiRoute): PromptBlock[] {
  const folder = PROMPTS[route];
  const version = folder.versions[folder.current];
  if (!version) throw new Error(`prompt ${route}: no version ${folder.current}`);
  // The scenario block below ends the cached part, so the folder's own marks are dropped.
  return version.system.map((b) => ({ text: b.text }));
}

/** The scenario block: the same text for every turn of a conversation. */
export function scenarioBlock(s: ScenarioInfo): PromptBlock {
  const lines = [
    'Scenario.',
    `Mode: ${s.mode === 'case_coach' ? 'case coach: short questions that make the learner use the target cases, one at a time' : 'conversation in a role'}.`,
    `Title: ${s.titleEn} (${s.titleSk}).`,
    `Learner level: ${s.level}.`,
    `Goal of the learner: ${s.goalEn}`,
    `Setting: ${s.settingSk}`,
    `Your role: ${s.tutorRole}`,
    `Your opening line was: ${s.openingSk}`,
    `Target cases: ${s.targetCases.map((c) => CASE_NAMES[c]).join(', ')}.`,
    `Target triggers: ${s.targetTriggers.join(', ')}.`,
    'Success criteria:',
    ...s.successCriteria.map((c) => `- ${c.id}: ${c.textEn}`),
    `Vocabulary hint: ${s.vocabHint.map((v) => `${v.sk} (${v.en})`).join(', ') || 'none'}.`,
  ];
  return { text: lines.join('\n'), cache: true };
}

export function systemFor(route: AiRoute, scenario: ScenarioInfo): PromptBlock[] {
  return [...baseBlocks(route), scenarioBlock(scenario)];
}

function transcript(history: TurnContext['history']): string {
  const recent = history.slice(-HISTORY_MESSAGES);
  if (recent.length === 0) return '(no earlier messages)';
  return recent
    .map(
      (m) =>
        `${m.role === 'tutor' ? 'Tutor' : m.role === 'learner' ? 'Learner' : 'Note'}: ${m.content}`,
    )
    .join('\n');
}

function criteriaLines(criteria: TurnContext['criteria']): string {
  if (criteria.length === 0) return '(none)';
  return criteria
    .map((c) => `- ${c.id}: ${c.textEn} (${c.met ? 'met' : 'not met yet'})`)
    .join('\n');
}

/** The user message of `tutor.analyze`. The mock of the route reads `<learner_message>`. */
export function analyzeUserMessage(ctx: TurnContext): string {
  const open =
    ctx.openErrors.length === 0
      ? '(none)'
      : ctx.openErrors
          .map(
            (e) =>
              `- id ${e.id}: the learner wrote "${e.given}"` +
              (e.caseExpected ? `, the ${CASE_NAMES[e.caseExpected]} is needed` : '') +
              (e.lemma ? `, word ${e.lemma}` : '') +
              (e.trigger ? `, after ${e.trigger}` : ''),
          )
          .join('\n');
  return [
    'Success criteria:',
    criteriaLines(ctx.criteria),
    '',
    'Open prompted errors:',
    open,
    '',
    'Conversation so far:',
    transcript(ctx.history),
    '',
    'Learner message to check. Offsets count from its first character.',
    '<learner_message>',
    ctx.message,
    '</learner_message>',
  ].join('\n');
}

export function analyzeRequest(ctx: TurnContext): {
  route: 'tutor.analyze';
  system: PromptBlock[];
  messages: ChatMessage[];
} {
  return {
    route: 'tutor.analyze',
    system: systemFor('tutor.analyze', ctx.scenario),
    messages: [{ role: 'user', content: analyzeUserMessage(ctx) }],
  };
}

/** The directive as the reply model reads it. */
export function renderDirective(d: ReplyDirective): string {
  const lines: string[] = ['<directive>'];
  lines.push('prompts:');
  if (d.prompts.length === 0) lines.push('  (none)');
  for (const p of d.prompts)
    lines.push(
      `  - the learner wrote "${p.given}"; the ${CASE_NAMES[p.caseExpected]} is needed` +
        (p.trigger ? ` after ${p.trigger}` : '') +
        (p.lemma ? ` (word ${p.lemma})` : '') +
        (p.question ? `; suggested question: ${p.question}` : ''),
    );
  lines.push('confirm:');
  if (d.confirm.length === 0) lines.push('  (none)');
  for (const c of d.confirm) lines.push(`  - ${c.form}`);
  lines.push('corrections:');
  if (d.corrections.length === 0) lines.push('  (none)');
  for (const c of d.corrections)
    lines.push(`  - "${c.given}" should be "${c.expected}": ${c.reasonEn}`);
  lines.push(`meaningOk: ${d.meaningOk}`);
  lines.push(
    `goal: ${d.goal.allMet ? 'every criterion is met' : d.goal.next ? `next criterion ${d.goal.next.id}: ${d.goal.next.textEn}` : 'keep the conversation going'}`,
  );
  lines.push(`allowedForms: ${d.allowedForms.length > 0 ? d.allowedForms.join(', ') : '(none)'}`);
  if (d.closing) lines.push('closing: the conversation ends soon; start to wrap up.');
  lines.push('</directive>');
  return lines.join('\n');
}

export function replyRequest(
  ctx: TurnContext,
  directive: ReplyDirective,
): { route: 'tutor.reply'; system: PromptBlock[]; messages: ChatMessage[] } {
  const content = [
    'Conversation so far:',
    transcript(ctx.history),
    '',
    '<learner_message>',
    ctx.message,
    '</learner_message>',
    '',
    renderDirective(directive),
  ].join('\n');
  return {
    route: 'tutor.reply',
    system: systemFor('tutor.reply', ctx.scenario),
    messages: [{ role: 'user', content }],
  };
}

/** `tutor.reply` with the task translate, used by peek. */
export function translateRequest(
  scenario: ScenarioInfo,
  text: string,
): { route: 'tutor.reply'; system: PromptBlock[]; messages: ChatMessage[] } {
  return {
    route: 'tutor.reply',
    system: systemFor('tutor.reply', scenario),
    messages: [
      {
        role: 'user',
        content: `<directive>\ntask: translate\n</directive>\n<text>\n${text}\n</text>`,
      },
    ],
  };
}

export interface SummaryFacts {
  criteria: TurnContext['criteria'];
  learnerMessages: number;
  errors: {
    given: string;
    expected: string;
    caseExpected?: Case | undefined;
    trigger?: string | undefined;
    fixedAlone: boolean;
  }[];
  otherErrors: number;
}

export function summaryRequest(
  scenario: ScenarioInfo,
  facts: SummaryFacts,
): { route: 'tutor.summary'; system: PromptBlock[]; messages: ChatMessage[] } {
  const errors =
    facts.errors.length === 0
      ? '(none)'
      : facts.errors
          .map(
            (e) =>
              `- wrote "${e.given}", correct "${e.expected}"` +
              (e.caseExpected ? `, ${CASE_NAMES[e.caseExpected]}` : '') +
              (e.trigger ? ` after ${e.trigger}` : '') +
              (e.fixedAlone ? ', fixed alone' : ''),
          )
          .join('\n');
  const content = [
    `Goal: ${scenario.goalEn}`,
    'Success criteria:',
    criteriaLines(facts.criteria),
    `Messages the learner wrote: ${facts.learnerMessages}`,
    'Checked case errors:',
    errors,
    `Other small slips (word order, vocabulary, spelling): ${facts.otherErrors}`,
  ].join('\n');
  return {
    route: 'tutor.summary',
    system: systemFor('tutor.summary', scenario),
    messages: [{ role: 'user', content }],
  };
}
