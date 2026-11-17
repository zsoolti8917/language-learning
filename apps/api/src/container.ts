// Wires each port to its implementation. Every provider module's `port.ts` factory is called
// here; a backend package changes its own `port.ts`, never this file.
import { type AiGateway, createGateway } from '@app/ai';
import type { Database } from '@app/db';
import { createAnalyzerPort } from './modules/analyzer/port';
import { createAttemptsPort } from './modules/declension/port';
import { createDictionaryPort, createMorphologyPort } from './modules/lexicon/port';
import { createNotesPort } from './modules/notes/port';
import { createVerifier, type TokenVerifier } from './platform/auth';
import { createBackground } from './platform/background';
import { systemClock, uuidV7Ids } from './platform/clock';
import type { Config } from './platform/config';
import type { AppDeps } from './platform/deps';
import { createProfileGuard } from './platform/profile';
import { createUsageFunctions } from './platform/usage';
import type { Background, Clock, IdGenerator, PortContext, Ports } from './ports';

export interface ContainerOptions {
  config: Config;
  database: Database;
  clock?: Clock;
  ids?: IdGenerator;
  background?: Background;
  /** The token check; default from the config (dev login or Supabase keys). */
  auth?: TokenVerifier;
  /**
   * Builds the gateway from its config (with the two usage functions on `app.ai_call`).
   * Default `createGateway` of `@app/ai`. Tests pass a mock.
   */
  gateway?: (config: Parameters<typeof createGateway>[0]) => AiGateway;
  /** Replaces single ports, e.g. a failing analyzer in a test. */
  ports?: Partial<Ports>;
}

/** Builds the ports in dependency order; each factory sees the others through ctx.ports. */
export function createPorts(
  ctx: Omit<PortContext, 'ports'>,
  overrides: Partial<Ports> = {},
): Ports {
  const ports = {} as Ports;
  const full: PortContext = { ...ctx, ports };
  ports.morphology = overrides.morphology ?? createMorphologyPort(full);
  ports.dictionary = overrides.dictionary ?? createDictionaryPort(full);
  ports.notes = overrides.notes ?? createNotesPort(full);
  ports.attempts = overrides.attempts ?? createAttemptsPort(full);
  ports.analyzer = overrides.analyzer ?? createAnalyzerPort(full);
  return ports;
}

export function createContainer(opts: ContainerOptions): AppDeps {
  const { config, database } = opts;
  const clock = opts.clock ?? systemClock;
  const ids = opts.ids ?? uuidV7Ids;
  const background = opts.background ?? createBackground();
  const usage = createUsageFunctions({ database, clock, ids });
  const ai = (opts.gateway ?? createGateway)({
    mode: config.aiMode,
    ...(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {}),
    dailyBudgetUsd: config.aiDailyBudgetUsd,
    models: config.aiModels,
    ...usage,
  });
  const base = { config, database, clock, ids, ai, background };
  return {
    ...base,
    ports: createPorts(base, opts.ports),
    auth: opts.auth ?? createVerifier(config),
    profiles: createProfileGuard(database),
    usage,
  };
}
