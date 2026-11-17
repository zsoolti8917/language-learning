// Mock helpers of M5's feature mock files. `featureMock` is the shared `mockEndpoint`
// (src/mocks/endpoint, which has no import cycle with the feature mocks).
import { HttpResponse } from 'msw';

export { mockEndpoint as featureMock } from '../../mocks/endpoint';

/** An error answer in the contract's shape. */
export function errorResponse(code: 'not_found', message: string, status = 404): Response {
  return HttpResponse.json({ error: { code, message } }, { status });
}
