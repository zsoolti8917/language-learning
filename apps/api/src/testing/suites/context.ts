// The shared set up of the port suites: a test database with the mini dataset, the mock
// gateway with the real usage functions, a fixed clock, and the stand in ports. A suite gives
// `make` this PortContext, so a real port is built exactly as container.ts builds it.
import { createConfiguredMock, type MockGateway } from '@app/ai';
import { createTestDb, type TestDb } from '@app/testkit';
import { createPorts } from '../../container';
import { createBackground } from '../../platform/background';
import { createFixedClock, uuidV7Ids } from '../../platform/clock';
import { loadConfig } from '../../platform/config';
import { createUsageFunctions } from '../../platform/usage';
import type { PortContext } from '../../ports';
import { TEST_ENV } from '../app';

export interface SuiteEnv {
  ctx: PortContext;
  db: TestDb;
  gateway: MockGateway;
  /** A new learner with a profile row. */
  learner(): Promise<string>;
  close(): Promise<void>;
}

/**
 * Returns an env that the caller made in its own `beforeAll`, so several suites in one file
 * share one test database (each database costs about two seconds).
 */
export type SharedSuiteEnv = () => SuiteEnv;

export async function createSuiteEnv(): Promise<SuiteEnv> {
  const db = await createTestDb({ content: 'mini' });
  const config = loadConfig(TEST_ENV);
  const clock = createFixedClock();
  const ids = uuidV7Ids;
  const gateway = createConfiguredMock({
    mode: 'mock',
    dailyBudgetUsd: config.aiDailyBudgetUsd,
    ...createUsageFunctions({ database: db, clock, ids }),
  });
  const base = { config, database: db, clock, ids, ai: gateway, background: createBackground() };
  const ports = createPorts(base);
  return {
    ctx: { ...base, ports },
    db,
    gateway,
    learner: async () => (await db.factory.profile()).userId,
    close: () => db.close(),
  };
}
