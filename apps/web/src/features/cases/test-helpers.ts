// Shared setup of this feature's tests: the feature's mock answers, a clean local database,
// a log of the requests the screens send, and a switch for the connection.
import { afterEach, beforeEach } from 'vitest';
import { clearLocalData } from '../../lib/db';
import { server } from '../../test/utils';
import { casesHandlers, resetCasesMock } from './mocks';

export interface LoggedRequest {
  method: string;
  path: string;
  body: unknown;
}

/** Every API request of the test, with its parsed body. */
export function useCasesMock(): { log: LoggedRequest[] } {
  const state = { log: [] as LoggedRequest[] };
  const onStart = async ({ request }: { request: Request }) => {
    const text = await request.clone().text();
    state.log.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: text ? JSON.parse(text) : undefined,
    });
  };
  beforeEach(async () => {
    state.log.length = 0;
    resetCasesMock();
    await clearLocalData();
    server.use(...casesHandlers);
    server.events.on('request:start', onStart);
  });
  afterEach(() => {
    server.events.removeListener('request:start', onStart);
  });
  return state;
}

/** Fakes navigator.onLine and fires the window event, as the browser does. */
export function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}
