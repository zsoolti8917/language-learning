// The mock gateway: scripted answers by route, a log of every call, and the same budget check
// and usage rows as the real gateway. Tests and local mode use it; no network is involved.
import type { AiCallStatus, AiRoute } from '@app/contracts';
import {
  type AiErrorCode,
  type AiGateway,
  AiGatewayError,
  type ChatMessage,
  type GatewayConfig,
  modelFor,
  type PromptBlock,
  type StreamRequest,
  type StructuredRequest,
  type Usage,
  usageStatusOf,
} from './types';

/** One scripted answer. */
export type ScriptedAnswer =
  /** For `structured`: the raw answer, which is parsed with the request's schema. */
  | { data: unknown; usage?: Partial<Usage> }
  /** For `stream` (and `structured`, as JSON text): the text, or its pieces in order. */
  | { text: string | string[]; usage?: Partial<Usage> }
  /** A failure: the call throws `AiGatewayError` with this code. */
  | { error: Exclude<AiErrorCode, 'budget_exceeded'>; message?: string; usage?: Partial<Usage> };

/** A call the mock received (after the budget check passed). */
export interface RecordedCall {
  kind: 'structured' | 'stream';
  route: AiRoute;
  userId: string;
  system: PromptBlock[];
  messages: ChatMessage[];
  maxTokens: number | undefined;
}

/** Computes an answer from the call; used when no scripted answer is queued. */
export type Responder = (call: RecordedCall) => ScriptedAnswer | Promise<ScriptedAnswer>;

export interface MockGatewayOptions extends Partial<GatewayConfig> {
  /** Answers for routes that have nothing queued and no responder. */
  defaults?: Partial<Record<AiRoute, Responder>>;
}

export interface MockGateway extends AiGateway {
  /** Queues answers for a route; each call takes the next one (first in, first out). */
  script(route: AiRoute, ...answers: ScriptedAnswer[]): MockGateway;
  /** Answers every call of a route that finds its queue empty. */
  respond(route: AiRoute, responder: Responder): MockGateway;
  /** Every call that reached the model, in order. */
  readonly calls: readonly RecordedCall[];
  callsFor(route: AiRoute): RecordedCall[];
  /** Scripted answers not used yet, over all routes. */
  pending(): number;
  /** Forgets calls, queues and responders. */
  reset(): void;
}

/** Usage of a mock answer when the script gives none: token counts from the text, cost 0. */
function usageOf(
  model: string,
  call: RecordedCall,
  out: string,
  extra: Partial<Usage> | undefined,
): Usage {
  const input =
    call.system.reduce((n, b) => n + b.text.length, 0) +
    call.messages.reduce((n, m) => n + m.content.length, 0);
  return {
    model,
    inputTokens: Math.ceil(input / 4),
    outputTokens: Math.ceil(out.length / 4),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    requestId: null,
    ...extra,
  };
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Splits a text into pieces that keep their spaces: 'S kým ideš' → ['S ', 'kým ', 'ideš']. */
function piecesOf(text: string | string[]): string[] {
  if (Array.isArray(text)) return text;
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function createMockGateway(opts: MockGatewayOptions = {}): MockGateway {
  const queues = new Map<AiRoute, ScriptedAnswer[]>();
  const responders = new Map<AiRoute, Responder>();
  const calls: RecordedCall[] = [];

  async function checkBudget(userId: string): Promise<void> {
    if (!opts.spendToday || opts.dailyBudgetUsd === undefined) return;
    const spend = await opts.spendToday(userId);
    if (spend.spentUsd >= opts.dailyBudgetUsd) {
      throw new AiGatewayError('budget_exceeded', 'The daily model budget is used up.', {
        resetsAt: spend.resetsAt,
      });
    }
  }

  async function answerFor(call: RecordedCall): Promise<ScriptedAnswer> {
    const queued = queues.get(call.route)?.shift();
    if (queued) return queued;
    const responder = responders.get(call.route) ?? opts.defaults?.[call.route];
    if (responder) return responder(call);
    return { error: 'upstream_failed', message: `mock gateway: no answer for ${call.route}` };
  }

  async function record(call: RecordedCall, usage: Usage, status: AiCallStatus): Promise<void> {
    await opts.recordUsage?.({
      userId: call.userId,
      route: call.route,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUsd: usage.costUsd,
      latencyMs: usage.latencyMs,
      status,
      requestId: usage.requestId,
    });
  }

  /** Runs one call: budget, answer, usage row. Returns the answer's text or data. */
  async function run(
    kind: RecordedCall['kind'],
    req: StructuredRequest<unknown> | StreamRequest,
  ): Promise<{
    answer: Exclude<ScriptedAnswer, { error: unknown }>;
    usage: Usage;
    call: RecordedCall;
  }> {
    if (req.signal?.aborted) throw abortError();
    await checkBudget(req.userId);
    const call: RecordedCall = {
      kind,
      route: req.route,
      userId: req.userId,
      system: req.system,
      messages: req.messages,
      maxTokens: req.maxTokens,
    };
    calls.push(call);
    const model = modelFor(req.route, opts.models);
    const answer = await answerFor(call);
    if ('error' in answer) {
      const usage = usageOf(model, call, '', answer.usage);
      await record(call, usage, usageStatusOf(answer.error));
      throw new AiGatewayError(answer.error, answer.message ?? `mock gateway: ${answer.error}`, {
        route: req.route,
      });
    }
    const out = 'data' in answer ? JSON.stringify(answer.data) : piecesOf(answer.text).join('');
    return { answer, usage: usageOf(model, call, out, answer.usage), call };
  }

  const gateway: MockGateway = {
    async structured<T>(req: StructuredRequest<T>) {
      const { answer, usage, call } = await run('structured', req as StructuredRequest<unknown>);
      let raw: unknown;
      try {
        raw = 'data' in answer ? answer.data : JSON.parse(piecesOf(answer.text).join(''));
      } catch {
        raw = undefined;
      }
      const parsed = req.schema.safeParse(raw);
      if (!parsed.success) {
        await record(call, usage, 'error');
        throw new AiGatewayError('upstream_failed', 'The model answer does not match the schema.', {
          route: req.route,
          reason: 'invalid_output',
        });
      }
      await record(call, usage, 'ok');
      return { data: parsed.data, usage };
    },

    async stream(req: StreamRequest) {
      const { answer, usage, call } = await run('stream', req);
      const pieces = 'text' in answer ? piecesOf(answer.text) : [JSON.stringify(answer.data)];
      let text = '';
      for (const piece of pieces) {
        // Let the caller act between pieces, as with a real stream.
        await Promise.resolve();
        if (req.signal?.aborted) {
          await record(call, usage, 'error');
          throw abortError();
        }
        text += piece;
        req.onText(piece);
      }
      await record(call, usage, 'ok');
      return { text, usage };
    },

    script(route, ...answers) {
      const q = queues.get(route) ?? [];
      q.push(...answers);
      queues.set(route, q);
      return gateway;
    },
    respond(route, responder) {
      responders.set(route, responder);
      return gateway;
    },
    get calls() {
      return calls;
    },
    callsFor(route) {
      return calls.filter((c) => c.route === route);
    },
    pending() {
      let n = 0;
      for (const q of queues.values()) n += q.length;
      return n;
    },
    reset() {
      calls.length = 0;
      queues.clear();
      responders.clear();
    },
  };
  return gateway;
}
