// How SDK errors and stop reasons become gateway results.
import Anthropic from '@anthropic-ai/sdk';
import type { StopReason } from '@anthropic-ai/sdk/resources/messages/messages';
import type { AiRoute } from '@app/contracts';
import { AiGatewayError } from './types';

/** The error a cancelled call rejects with, as `fetch` does. */
export function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function isAbortError(e: unknown): boolean {
  return (
    e instanceof Anthropic.APIUserAbortError ||
    (e instanceof Error && e.name === 'AbortError') ||
    (e instanceof DOMException && e.name === 'AbortError')
  );
}

/** The provider's request id of an SDK error, if any. */
export function requestIdOf(e: unknown): string | null {
  return e instanceof Anthropic.APIError ? (e.requestID ?? null) : null;
}

/**
 * Maps an SDK error to `upstream_failed`. The SDK has already retried connection errors, 408,
 * 409, 429 and 5xx (twice by default), so whatever arrives here is final. The message names the
 * kind of failure only; provider bodies are not copied, so nothing secret reaches a log.
 */
export function mapSdkError(e: unknown, route: AiRoute): AiGatewayError {
  if (e instanceof AiGatewayError) return e;
  const details: Record<string, unknown> = { route };
  const requestId = requestIdOf(e);
  if (requestId) details.requestId = requestId;
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiGatewayError('upstream_failed', 'The model call timed out.', {
      ...details,
      reason: 'timeout',
    });
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new AiGatewayError('upstream_failed', 'The model could not be reached.', {
      ...details,
      reason: 'connection',
    });
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status;
    const reason =
      status === 429
        ? 'rate_limited'
        : status === 529
          ? 'overloaded'
          : status === 401 || status === 403
            ? 'auth'
            : status !== undefined && status >= 500
              ? 'provider_error'
              : 'bad_request';
    return new AiGatewayError('upstream_failed', `The model call failed (${status ?? '?'}).`, {
      ...details,
      status,
      reason,
    });
  }
  return new AiGatewayError('upstream_failed', 'The model call failed.', {
    ...details,
    reason: 'unknown',
  });
}

/**
 * The typed error for a stop reason, or null when the answer is complete.
 * - `end_turn`, `stop_sequence`: complete.
 * - `refusal`: `refused`, with the category of `stop_details`.
 * - `max_tokens`, `model_context_window_exceeded`: `truncated`.
 * - anything else (`tool_use`, `pause_turn`, none): `upstream_failed`; the gateway sends no
 *   tools, so these are unexpected.
 */
export function stopReasonError(
  stop: StopReason | null,
  route: AiRoute,
  extra: { category?: string | null; requestId?: string | null } = {},
): AiGatewayError | null {
  const details: Record<string, unknown> = { route, stopReason: stop };
  if (extra.requestId) details.requestId = extra.requestId;
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
      return null;
    case 'refusal':
      return new AiGatewayError('refused', 'The model declined to answer.', {
        ...details,
        category: extra.category ?? null,
      });
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return new AiGatewayError('truncated', 'The answer was cut off.', details);
    default:
      return new AiGatewayError('upstream_failed', 'The model stopped unexpectedly.', {
        ...details,
        reason: 'unexpected_stop',
      });
  }
}
