// The real gateway: one guarded door to the Claude API. For every call it checks the
// learner's budget, builds the request from the route table (model, effort, token limit,
// timeout) with the stable system prompt marked for caching, checks the stop reason, and
// writes one usage row with the cost from the price table.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { AiCallStatus, AiRoute } from '@app/contracts';
import type { ZodType } from 'zod';
import { abortError, isAbortError, mapSdkError, requestIdOf, stopReasonError } from './errors';
import { costOf } from './pricing';
import { type RouteOverrides, type RouteSettings, routeSettings } from './routes';
import {
  type AiGateway,
  AiGatewayError,
  type GatewayConfig,
  type PromptBlock,
  type StreamRequest,
  type StructuredRequest,
  type Usage,
  usageStatusOf,
} from './types';

type MessageCreateParams = Anthropic.MessageCreateParamsNonStreaming;
type ApiMessage = Anthropic.Message;
type ApiUsage = Anthropic.Usage;

export interface AnthropicGatewayOptions {
  /** The SDK client. Tests pass one with a stubbed `fetch`; default: a client with `apiKey`. */
  client?: Anthropic;
  /** Effort, token limit and timeout per route (`routeOverridesFromEnv(process.env)`). */
  routes?: RouteOverrides;
  /** Milliseconds for the latency measure; default `performance.now`. */
  now?: () => number;
}

/** What `buildRequest` produces; exported for tests and the smoke script. */
export type GatewayRequestParams = MessageCreateParams;

/**
 * The SDK system blocks: one text block per prompt block, with `cache_control` on the last
 * block marked `cache: true`. Blocks after it (per request text) are not cached.
 */
export function systemBlocks(system: readonly PromptBlock[]): Anthropic.TextBlockParam[] {
  let mark = -1;
  system.forEach((b, i) => {
    if (b.cache) mark = i;
  });
  return system.map((b, i) =>
    i === mark
      ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: b.text },
  );
}

const formats = new WeakMap<ZodType, Anthropic.JSONOutputFormat>();

/** The JSON schema output format of a zod schema, built once per schema. */
function formatOf(schema: ZodType): Anthropic.JSONOutputFormat {
  let f = formats.get(schema);
  if (!f) {
    // zodOutputFormat also carries a `parse` function; the API needs only type and schema.
    const { type, schema: json } = zodOutputFormat(schema as never);
    f = { type, schema: json };
    formats.set(schema, f);
  }
  return f;
}

/** The request body of a call. */
export function buildRequest(
  settings: RouteSettings,
  req: Pick<StructuredRequest<unknown>, 'system' | 'messages' | 'maxTokens'> & {
    schema?: ZodType;
  },
): MessageCreateParams {
  return {
    model: settings.model,
    max_tokens: req.maxTokens ?? settings.maxTokens,
    system: systemBlocks(req.system),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    output_config: {
      effort: settings.effort,
      ...(req.schema ? { format: formatOf(req.schema) } : {}),
    },
  };
}

/** The gateway's usage of an SDK usage object (or of none, for a failed call). */
function usageOf(
  model: string,
  u: Partial<ApiUsage> | undefined,
  latencyMs: number,
  requestId: string | null,
): Usage {
  const counts = {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: u?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
  return {
    model,
    inputTokens: counts.inputTokens,
    outputTokens: counts.outputTokens,
    cacheReadTokens: counts.cacheReadTokens,
    cacheWriteTokens: counts.cacheWriteTokens,
    costUsd: costOf(model, counts),
    latencyMs: Math.max(0, Math.round(latencyMs)),
    requestId,
  };
}

function textOf(message: ApiMessage): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export function createAnthropicGateway(
  config: GatewayConfig,
  opts: AnthropicGatewayOptions = {},
): AiGateway {
  const client =
    opts.client ??
    (() => {
      if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY is required when AI_MODE=anthropic.');
      return new Anthropic({ apiKey: config.apiKey });
    })();
  const now = opts.now ?? (() => performance.now());

  async function checkBudget(userId: string): Promise<void> {
    const spend = await config.spendToday(userId);
    if (spend.spentUsd >= config.dailyBudgetUsd) {
      throw new AiGatewayError('budget_exceeded', 'The daily model budget is used up.', {
        resetsAt: spend.resetsAt,
      });
    }
  }

  async function record(
    route: AiRoute,
    userId: string,
    usage: Usage,
    status: AiCallStatus,
  ): Promise<void> {
    await config.recordUsage({
      userId,
      route,
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

  /** Records a failed call and returns the error to throw. */
  async function fail(
    route: AiRoute,
    userId: string,
    usage: Usage,
    e: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Error> {
    if (isAbortError(e) || signal?.aborted) {
      await record(route, userId, usage, 'error');
      return abortError();
    }
    const err = mapSdkError(e, route);
    await record(route, userId, usage, usageStatusOf(err.code));
    return err;
  }

  return {
    async structured<T>(req: StructuredRequest<T>) {
      if (req.signal?.aborted) throw abortError();
      await checkBudget(req.userId);
      const settings = routeSettings(req.route, config.models, opts.routes);
      const body = buildRequest(settings, req as StructuredRequest<unknown>);
      const started = now();
      let message: ApiMessage;
      let requestId: string | null;
      try {
        const res = await client.messages
          .create(body, { timeout: settings.timeoutMs, signal: req.signal ?? null })
          .withResponse();
        message = res.data;
        requestId = res.request_id ?? null;
      } catch (e) {
        const usage = usageOf(settings.model, undefined, now() - started, requestIdOf(e));
        throw await fail(req.route, req.userId, usage, e, req.signal);
      }
      const usage = usageOf(settings.model, message.usage, now() - started, requestId);
      const stopped = stopReasonError(message.stop_reason, req.route, {
        category: message.stop_details?.category ?? null,
        requestId,
      });
      if (stopped) {
        await record(req.route, req.userId, usage, usageStatusOf(stopped.code));
        throw stopped;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(textOf(message));
      } catch {
        raw = undefined;
      }
      const parsed = req.schema.safeParse(raw);
      if (!parsed.success) {
        await record(req.route, req.userId, usage, 'error');
        throw new AiGatewayError('upstream_failed', 'The model answer does not match the schema.', {
          route: req.route,
          reason: 'invalid_output',
          ...(requestId ? { requestId } : {}),
        });
      }
      await record(req.route, req.userId, usage, 'ok');
      return { data: parsed.data, usage };
    },

    async stream(req: StreamRequest) {
      if (req.signal?.aborted) throw abortError();
      await checkBudget(req.userId);
      const settings = routeSettings(req.route, config.models, opts.routes);
      const body = buildRequest(settings, req);
      const started = now();
      const stream = client.messages.stream(body, {
        timeout: settings.timeoutMs,
        signal: req.signal ?? null,
      });
      let text = '';
      let handlerError: unknown;
      stream.on('text', (delta) => {
        if (handlerError) return;
        text += delta;
        try {
          req.onText(delta);
        } catch (e) {
          // A failing consumer ends the call; the stream is aborted below.
          handlerError = e;
          stream.abort();
        }
      });
      let message: ApiMessage;
      try {
        message = await stream.finalMessage();
      } catch (e) {
        // Tokens already generated are billed, so the row takes the usage seen so far.
        const usage = usageOf(
          settings.model,
          stream.currentMessage?.usage,
          now() - started,
          stream.request_id ?? requestIdOf(e),
        );
        if (handlerError) {
          await record(req.route, req.userId, usage, 'error');
          throw handlerError;
        }
        throw await fail(req.route, req.userId, usage, e, req.signal);
      }
      const requestId = stream.request_id ?? null;
      const usage = usageOf(settings.model, message.usage, now() - started, requestId);
      const stopped = stopReasonError(message.stop_reason, req.route, {
        category: message.stop_details?.category ?? null,
        requestId,
      });
      if (stopped) {
        // The pieces already sent must be dropped by the caller (the tutor sends `error`).
        await record(req.route, req.userId, usage, usageStatusOf(stopped.code));
        throw stopped;
      }
      await record(req.route, req.userId, usage, 'ok');
      return { text, usage };
    },
  };
}
