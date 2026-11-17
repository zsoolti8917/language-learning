import type { ErrorCode } from '@app/contracts';

/** The fixed codes of the API, plus `network` when no answer arrived at all. */
export type ApiErrorCode = ErrorCode | 'network';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
  502: 'upstream_failed',
};

/** Every failed API call rejects with this. `status` is 0 when the network failed. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** No answer from the server: offline, DNS, CORS or a dropped connection. */
  get isNetwork(): boolean {
    return this.code === 'network';
  }

  /** Worth sending again later: network, 5xx, 429 and 408. A 4xx is the request's fault. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429 || this.status === 408;
  }

  /** `details.retryAfterSeconds` of `rate_limited`, if any. */
  get retryAfterSeconds(): number | undefined {
    const v = this.details.retryAfterSeconds;
    return typeof v === 'number' ? v : undefined;
  }

  static network(cause: unknown): ApiError {
    const e = new ApiError(0, 'network', 'No connection to the server.');
    (e as { cause?: unknown }).cause = cause;
    return e;
  }

  /** Builds the error from a failed response, reading `{ error: { code, message, details } }`. */
  static async fromResponse(res: Response): Promise<ApiError> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } })
      ?.error;
    const fallback: ErrorCode = STATUS_CODES[res.status] ?? 'internal';
    const code = typeof err?.code === 'string' ? (err.code as ErrorCode) : fallback;
    const message =
      typeof err?.message === 'string' ? err.message : `Request failed with ${res.status}.`;
    const details =
      err?.details && typeof err.details === 'object'
        ? (err.details as Record<string, unknown>)
        : {};
    return new ApiError(res.status, code, message, details);
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
