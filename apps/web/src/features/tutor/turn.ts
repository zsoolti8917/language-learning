// One tutor turn on the client: send the message, read the stream, turn each event into an action.
import { type ApiClient, isApiError, StreamFormatError } from '../../lib/api';
import type { ChatAction } from './chatState';

export interface TurnInput {
  conversationId: string;
  clientId: string;
  content: string;
  signal?: AbortSignal;
}

/** Normal form of a message before it is sent and shown: NFC, trimmed. */
export function prepareMessage(text: string): string {
  return text.normalize('NFC').trim();
}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e as { name?: string } | null)?.name === 'AbortError';
}

/**
 * Sends one learner message and dispatches the turn: `send`, then `analysis`, `delta`…, `done`,
 * or `failed` when an `error` event arrives, the request fails or the stream breaks off.
 * A retry calls this again with the same `clientId`, so the server stores the message once.
 * Resolves when the turn is over; an aborted turn dispatches nothing more.
 */
export async function runTurn(
  api: Pick<ApiClient, 'tutor'>,
  input: TurnInput,
  dispatch: (action: ChatAction) => void,
): Promise<void> {
  const { conversationId, clientId, content, signal } = input;
  dispatch({ type: 'send', clientId, content });
  try {
    const stream = await api.tutor.sendMessage(
      { params: { id: conversationId }, body: { clientId, content } },
      signal ? { signal } : {},
    );
    for await (const ev of stream) {
      if (signal?.aborted) return;
      switch (ev.event) {
        case 'analysis':
          dispatch({ type: 'analysis', clientId, data: ev.data });
          break;
        case 'delta':
          dispatch({ type: 'delta', clientId, text: ev.data.text });
          break;
        case 'done':
          dispatch({ type: 'done', clientId, data: ev.data });
          return;
        case 'error':
          dispatch({
            type: 'failed',
            clientId,
            code: ev.data.code,
            message: ev.data.message,
            details: ev.data.details ?? {},
          });
          return;
      }
    }
    // The stream ended without `done` or `error`: the connection broke off.
    if (!signal?.aborted) {
      dispatch({ type: 'failed', clientId, code: 'stream', message: 'stream ended', details: {} });
    }
  } catch (e) {
    if (isAbort(e, signal)) return;
    if (isApiError(e)) {
      dispatch({ type: 'failed', clientId, code: e.code, message: e.message, details: e.details });
    } else if (e instanceof StreamFormatError) {
      dispatch({ type: 'failed', clientId, code: 'stream', message: e.message, details: {} });
    } else {
      dispatch({ type: 'failed', clientId, code: 'network', message: String(e), details: {} });
    }
  }
}
