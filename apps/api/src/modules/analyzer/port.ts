// AnalyzerPort of the analyzer module. Owner: B3, who replaces the body of this factory with
// the real port. container.ts calls it. Other ports are read from ctx.ports at call time.
import type { AnalyzerPort, PortContext } from '../../ports';
import { createSimpleAnalyzer } from '../../testing/analyzer';

export function createAnalyzerPort(ctx: PortContext): AnalyzerPort {
  return createSimpleAnalyzer({
    morphology: () => ctx.ports.morphology,
    dictionary: () => ctx.ports.dictionary,
  });
}
