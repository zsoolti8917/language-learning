// Record and replay. `recordGateway` wraps any gateway (usually the real one, in the smoke
// script or an eval run) and keeps each call with its answer as plain JSON. `replay` queues
// those answers on a mock gateway, so a test runs offline against answers a real model gave.
import type { AiRoute } from '@app/contracts';
import { isAbortError } from './errors';
import type { MockGateway, ScriptedAnswer } from './mock';
import {
  type AiGateway,
  type ChatMessage,
  isAiGatewayError,
  type PromptBlock,
  type Usage,
} from './types';

/** One recorded call. Serialisable with `JSON.stringify`. */
export interface Recording {
  kind: 'structured' | 'stream';
  route: AiRoute;
  system: PromptBlock[];
  messages: ChatMessage[];
  /** The answer as the mock takes it: data, stream pieces, or the error code. */
  answer: ScriptedAnswer;
}

export interface RecordingGateway extends AiGateway {
  readonly recordings: readonly Recording[];
  /** The recordings as JSON text, for a fixture file. */
  toJSON(): Recording[];
}

function usageFields(u: Usage): Partial<Usage> {
  return {
    model: u.model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    costUsd: u.costUsd,
  };
}

/** Wraps `inner` and records every call that reached the model (budget refusals are not). */
export function recordGateway(inner: AiGateway): RecordingGateway {
  const recordings: Recording[] = [];
  function keepError(base: Omit<Recording, 'answer'>, e: unknown): void {
    if (isAbortError(e)) return;
    if (isAiGatewayError(e) && e.code !== 'budget_exceeded')
      recordings.push({ ...base, answer: { error: e.code, message: e.message } });
  }
  return {
    get recordings() {
      return recordings;
    },
    toJSON() {
      return recordings.map((r) => structuredClone(r));
    },
    async structured(req) {
      const base = {
        kind: 'structured' as const,
        route: req.route,
        system: req.system,
        messages: req.messages,
      };
      try {
        const res = await inner.structured(req);
        recordings.push({ ...base, answer: { data: res.data, usage: usageFields(res.usage) } });
        return res;
      } catch (e) {
        keepError(base, e);
        throw e;
      }
    },
    async stream(req) {
      const base = {
        kind: 'stream' as const,
        route: req.route,
        system: req.system,
        messages: req.messages,
      };
      const pieces: string[] = [];
      try {
        const res = await inner.stream({
          ...req,
          onText: (d) => {
            pieces.push(d);
            req.onText(d);
          },
        });
        recordings.push({ ...base, answer: { text: pieces, usage: usageFields(res.usage) } });
        return res;
      } catch (e) {
        keepError(base, e);
        throw e;
      }
    },
  };
}

/** Queues the recorded answers on `mock`, route by route in their recorded order. */
export function replay(mock: MockGateway, recordings: readonly Recording[]): MockGateway {
  for (const r of recordings) mock.script(r.route, r.answer);
  return mock;
}
