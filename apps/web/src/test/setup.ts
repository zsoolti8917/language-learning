// Global setup of the web tests (vite.config.ts `test.setupFiles`): jest-dom matchers,
// Testing Library cleanup, an IndexedDB stand in, and the mock server in Node.
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../mocks/node';

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(cleanup);

// Tests never reach the network: a request without a handler fails the test.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Node environment without storage.
  }
});

if (typeof window !== 'undefined') {
  // jsdom lacks a few browser APIs that Radix, vaul and the router touch.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (!('ResizeObserver' in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // jsdom defines scrollTo but only logs "not implemented"; the router calls it on navigation.
  window.scrollTo = () => {};
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView ??= () => {};
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
}
