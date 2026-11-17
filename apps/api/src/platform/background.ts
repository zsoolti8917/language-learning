// runInBackground: work that continues after the response, such as a text analysis.
// On Vercel it uses the request context's waitUntil; elsewhere it tracks the promise, so
// tests and shutdown can wait for it. A failed task is logged, never thrown at the caller.
import type { Background } from '../ports';

type WaitUntil = (p: Promise<unknown>) => void;

/** Vercel's request context, as `@vercel/functions` reads it. Null outside Vercel. */
function vercelWaitUntil(): WaitUntil | null {
  const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] as
    | { get?: () => { waitUntil?: WaitUntil } | undefined }
    | undefined;
  return ctx?.get?.()?.waitUntil ?? null;
}

export function createBackground(
  onError: (e: unknown) => void = (e) => console.error('background task failed', e),
): Background {
  const running = new Set<Promise<unknown>>();
  return {
    runInBackground(task) {
      const tracked = task.catch(onError).finally(() => running.delete(tracked));
      running.add(tracked);
      vercelWaitUntil()?.(tracked);
    },
    async drain() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}
