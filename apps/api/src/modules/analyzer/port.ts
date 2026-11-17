// AnalyzerPort of the analyzer module. Owner: B3. container.ts calls the factory. Other ports
// are read from ctx.ports at call time, never while the port is built.
import type { AnalyzerPort, PortContext } from '../../ports';
import { allTriggers, lemmasByIds, type TriggerFacts } from './repo';
import { analyzeText } from './service';

/** How long the trigger list is kept in memory. */
const TRIGGER_TTL_MS = 10 * 60 * 1000;

export function createAnalyzerPort(ctx: PortContext): AnalyzerPort {
  let cached: { at: number; rows: Promise<TriggerFacts[]> } | undefined;
  const triggers = () => {
    const now = ctx.clock.now().getTime();
    if (!cached || now - cached.at > TRIGGER_TTL_MS || now < cached.at) {
      const rows = ctx.database.withSystem((tx) => allTriggers(tx));
      cached = { at: now, rows };
      rows.catch(() => {
        if (cached?.rows === rows) cached = undefined;
      });
    }
    return cached.rows;
  };
  return {
    analyzeText(body, opts) {
      return analyzeText(
        {
          morphology: ctx.ports.morphology,
          dictionary: ctx.ports.dictionary,
          ai: ctx.ai,
          lemmas: (ids) => ctx.database.withSystem((tx) => lemmasByIds(tx, ids)),
          triggers,
        },
        body,
        opts,
      );
    },
  };
}
