// The start up port check (I1): outside tests every port is the real one, and only
// AI_MODE=mock keeps the mock gateway.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer } from '../container';
import { createRuntime, type Runtime } from '../runtime';
import { createSimpleAnalyzer } from '../testing/analyzer';
import { createMiniDictionary, createMiniMorphology } from '../testing/lexicon';
import { createAttemptsRecorder, createNotesRecorder } from '../testing/recorders';
import { uuidV7Ids } from './clock';
import { ConfigError, LOCAL_DEFAULTS, loadConfig } from './config';
import { assertRealPorts, isMockGateway, isStandIn, portReport } from './stand-in';

describe('start up port check', () => {
  let runtime: Runtime;
  beforeAll(async () => {
    // Local mode as `pnpm dev` and `pnpm e2e` run it, with PGlite in memory.
    runtime = await createRuntime({ ...LOCAL_DEFAULTS });
  });
  afterAll(async () => {
    await runtime?.close();
  });

  it('local mode resolves every port to its real implementation, the gateway to the mock', () => {
    expect(runtime.ports).toEqual({
      morphology: 'real',
      dictionary: 'real',
      notes: 'real',
      attempts: 'real',
      analyzer: 'real',
      gateway: 'mock',
    });
    expect(portReport(runtime.deps)).toEqual(runtime.ports);
  });

  it('every stand in of testing/ is recognised and refused', () => {
    const morphology = createMiniMorphology();
    const dictionary = createMiniDictionary();
    const standIns = {
      morphology,
      dictionary,
      notes: createNotesRecorder(uuidV7Ids),
      attempts: createAttemptsRecorder(),
      analyzer: createSimpleAnalyzer({ morphology: () => morphology, dictionary: () => dictionary }),
    };
    for (const port of Object.values(standIns)) expect(isStandIn(port)).toBe(true);
    for (const port of Object.values(runtime.deps.ports)) expect(isStandIn(port)).toBe(false);

    const deps = createContainer({
      config: runtime.config,
      database: runtime.database,
      ports: standIns,
    });
    expect(portReport(deps)).toMatchObject({
      morphology: 'stand-in',
      dictionary: 'stand-in',
      notes: 'stand-in',
      attempts: 'stand-in',
      analyzer: 'stand-in',
    });
    expect(() => assertRealPorts(deps, 'mock')).toThrow(ConfigError);
    expect(() => assertRealPorts(deps, 'mock')).toThrow(
      /morphology \(stand-in\), dictionary \(stand-in\), notes \(stand-in\), attempts \(stand-in\), analyzer \(stand-in\)/,
    );
    // One stand in is enough to refuse.
    const one = createContainer({
      config: runtime.config,
      database: runtime.database,
      ports: { notes: standIns.notes },
    });
    expect(() => assertRealPorts(one, 'mock')).toThrow(/notes \(stand-in\)/);
  });

  it('the gateway is the real one with AI_MODE=anthropic, and the mock is refused there', () => {
    const config = loadConfig({
      ...LOCAL_DEFAULTS,
      AI_MODE: 'anthropic',
      // Never used: building the gateway makes no call.
      ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key',
    });
    const real = createContainer({ config, database: runtime.database });
    expect(isMockGateway(real.ai)).toBe(false);
    expect(assertRealPorts(real, 'anthropic').gateway).toBe('real');

    const mocked = createContainer({ config: runtime.config, database: runtime.database });
    expect(isMockGateway(mocked.ai)).toBe(true);
    expect(() => assertRealPorts(mocked, 'anthropic')).toThrow(/gateway \(mock\)/);
    expect(() => assertRealPorts(real, 'mock')).toThrow(/gateway \(real\)/);
  });
});
