// A helper for tests that use the mock gateway: script answers, then assert the calls. It
// throws plain errors, so it works in any test runner and in the API's tests.
//
//   const ai = scriptedGateway(config)
//     .answer('tutor.analyze', { data: { errors: [] } })
//     .answer('tutor.reply', { text: ['S kým ', 'ideš?'] });
//   … run the code under test with `ai.gateway` …
//   ai.expectCalls('tutor.analyze', 1);
//   expect(ai.lastUserText('tutor.reply')).toContain('kino');
//   ai.expectAllUsed();
import type { AiRoute } from '@app/contracts';
import {
  createMockGateway,
  type MockGateway,
  type MockGatewayOptions,
  type RecordedCall,
  type ScriptedAnswer,
} from './mock';
import { type Recording, replay } from './record';

export interface ScriptedGateway {
  gateway: MockGateway;
  /** Queues answers for a route (first in, first out). */
  answer(route: AiRoute, ...answers: ScriptedAnswer[]): ScriptedGateway;
  /** Queues the answers of a recording. */
  replay(recordings: readonly Recording[]): ScriptedGateway;
  /** The calls of a route, in order. */
  calls(route: AiRoute): RecordedCall[];
  /** The last call of a route; throws when there is none. */
  lastCall(route: AiRoute): RecordedCall;
  /** The text of the last user message of the last call of a route. */
  lastUserText(route: AiRoute): string;
  /** The whole system prompt of the last call of a route, blocks joined by blank lines. */
  lastSystemText(route: AiRoute): string;
  /** Throws unless the route was called exactly `n` times. */
  expectCalls(route: AiRoute, n: number): void;
  /** Throws when a scripted answer was never used. */
  expectAllUsed(): void;
}

export function scriptedGateway(opts: MockGatewayOptions = {}): ScriptedGateway {
  const gateway = createMockGateway(opts);
  const s: ScriptedGateway = {
    gateway,
    answer(route, ...answers) {
      gateway.script(route, ...answers);
      return s;
    },
    replay(recordings) {
      replay(gateway, recordings);
      return s;
    },
    calls: (route) => gateway.callsFor(route),
    lastCall(route) {
      const c = gateway.callsFor(route).at(-1);
      if (!c) throw new Error(`no call of ${route}`);
      return c;
    },
    lastUserText(route) {
      const m = s
        .lastCall(route)
        .messages.filter((x) => x.role === 'user')
        .at(-1);
      if (!m) throw new Error(`the last call of ${route} has no user message`);
      return m.content;
    },
    lastSystemText: (route) =>
      s
        .lastCall(route)
        .system.map((b) => b.text)
        .join('\n\n'),
    expectCalls(route, n) {
      const got = gateway.callsFor(route).length;
      if (got !== n) throw new Error(`expected ${n} call(s) of ${route}, got ${got}`);
    },
    expectAllUsed() {
      const left = gateway.pending();
      if (left > 0) throw new Error(`${left} scripted answer(s) were never used`);
    },
  };
  return s;
}
