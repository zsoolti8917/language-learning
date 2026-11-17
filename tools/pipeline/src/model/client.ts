// The part of the Message Batches API the runner uses, behind an interface so tests and
// mock mode never reach the network. `anthropicBatchClient` is the only place in the
// pipeline that constructs the SDK client.
import Anthropic from '@anthropic-ai/sdk';
import type {
  BatchCreateParams,
  Message,
  MessageBatch,
  MessageBatchIndividualResponse,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';

export type BatchRequest = BatchCreateParams.Request;
export type { Message, MessageBatch, MessageBatchIndividualResponse };

export interface BatchClient {
  /** Submits one batch; returns it with its id. */
  create(requests: BatchRequest[]): Promise<MessageBatch>;
  /** The batch's current state. */
  retrieve(id: string): Promise<MessageBatch>;
  /** The results of an ended batch, in any order. */
  results(id: string): AsyncIterable<MessageBatchIndividualResponse>;
}

/**
 * The real client. The SDK resolves credentials itself (ANTHROPIC_API_KEY, an auth token or
 * a profile); the key is never read, logged or stored by the pipeline.
 */
export function anthropicBatchClient(options: { maxRetries?: number } = {}): BatchClient {
  const sdk = new Anthropic({ maxRetries: options.maxRetries ?? 4 });
  return {
    create: (requests) => sdk.messages.batches.create({ requests }),
    retrieve: (id) => sdk.messages.batches.retrieve(id),
    results: async function* (id) {
      for await (const r of await sdk.messages.batches.results(id)) yield r;
    },
  };
}

/** What a scripted answer can be: a JSON value (sent as text), raw text, or a failure. */
export type MockReply =
  | { json: unknown; stopReason?: Message['stop_reason'] }
  | { text: string; stopReason?: Message['stop_reason'] }
  | { error: string }
  | { expired: true };

export type MockResponder = (
  params: MessageCreateParamsNonStreaming,
  customId: string,
) => MockReply | Promise<MockReply>;

/** A fake message as the API would return it. Its usage is zero: a mock costs nothing. */
export function mockMessage(
  model: string,
  text: string,
  stopReason: Message['stop_reason'] = 'end_turn',
): Message {
  return {
    id: `msg_mock_${Math.random().toString(36).slice(2, 10)}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Message;
}

/**
 * An in-memory stand in for the Batches API. Every batch ends at the first `retrieve`.
 * `created` keeps the requests of every submitted batch, so a test can count what was sent.
 */
export class MockBatchClient implements BatchClient {
  readonly created: BatchRequest[][] = [];
  private readonly batches = new Map<string, { batch: MessageBatch; requests: BatchRequest[] }>();
  private n = 0;

  constructor(private readonly responder: MockResponder) {}

  /** Every request sent so far, over all batches. */
  get sent(): BatchRequest[] {
    return this.created.flat();
  }

  async create(requests: BatchRequest[]): Promise<MessageBatch> {
    this.created.push(requests);
    const id = `msgbatch_mock_${++this.n}`;
    const now = new Date(0).toISOString();
    const batch: MessageBatch = {
      id,
      type: 'message_batch',
      processing_status: 'in_progress',
      request_counts: {
        processing: requests.length,
        succeeded: 0,
        errored: 0,
        canceled: 0,
        expired: 0,
      },
      created_at: now,
      expires_at: now,
      ended_at: null,
      archived_at: null,
      cancel_initiated_at: null,
      results_url: null,
    };
    this.batches.set(id, { batch, requests });
    return { ...batch };
  }

  async retrieve(id: string): Promise<MessageBatch> {
    const b = this.batches.get(id);
    if (!b) throw new Error(`mock: no batch ${id}`);
    b.batch.processing_status = 'ended';
    b.batch.ended_at = new Date(0).toISOString();
    b.batch.request_counts = { ...b.batch.request_counts, processing: 0 };
    return { ...b.batch };
  }

  async *results(id: string): AsyncIterable<MessageBatchIndividualResponse> {
    const b = this.batches.get(id);
    if (!b) throw new Error(`mock: no batch ${id}`);
    for (const r of b.requests) {
      const reply = await this.responder(r.params, r.custom_id);
      const model = String(r.params.model);
      if ('expired' in reply) {
        yield { custom_id: r.custom_id, result: { type: 'expired' } };
      } else if ('error' in reply) {
        yield {
          custom_id: r.custom_id,
          result: {
            type: 'errored',
            error: {
              type: 'error',
              error: { type: 'api_error', message: reply.error },
              request_id: null,
            },
          },
        } as MessageBatchIndividualResponse;
      } else {
        const text = 'json' in reply ? JSON.stringify(reply.json) : reply.text;
        yield {
          custom_id: r.custom_id,
          result: { type: 'succeeded', message: mockMessage(model, text, reply.stopReason) },
        };
      }
    }
  }
}
