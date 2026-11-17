// Errors in the one shape `{ error: { code, message, details } }` (docs/contracts.md, "Errors").
// Handlers and services throw ApiError; app.ts maps everything else.
import { isAiGatewayError } from '@app/ai';
import { ERROR_STATUS, type ErrorCode, type ErrorResponse } from '@app/contracts';
import type { z } from 'zod';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export const unauthorized = (message = 'Sign in again.') => new ApiError('unauthorized', message);
export const forbidden = (message = 'Not allowed.') => new ApiError('forbidden', message);
export const notFound = (message = 'Not found.') => new ApiError('not_found', message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ApiError('conflict', message, details);
export const rateLimited = (message: string, retryAfterSeconds: number) =>
  new ApiError('rate_limited', message, { retryAfterSeconds });
export const budgetExceeded = (resetsAt: string) =>
  new ApiError('budget_exceeded', 'The daily model budget is used up.', { resetsAt });
export const upstreamFailed = (message = 'The model or the login service failed.') =>
  new ApiError('upstream_failed', message);

/** `validation_failed` with `details.fields`: `{ 'body.dayStartHour': 'Too big: …' }`. */
export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError('validation_failed', 'The request does not match the schema.', { fields });
}

/** The field map of a zod error, every path prefixed with `where` (params, query, body). */
export function fieldsOf(where: string, error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = [where, ...issue.path.map(String)].join('.');
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Turns any thrown value into an ApiError. Unknown errors become `internal`. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (isAiGatewayError(e)) {
    if (e.code === 'budget_exceeded') return budgetExceeded(String(e.details.resetsAt ?? ''));
    return upstreamFailed('The model failed to answer.');
  }
  return new ApiError('internal', 'Something went wrong.');
}

export function errorBody(e: ApiError): ErrorResponse {
  return {
    error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) },
  };
}
