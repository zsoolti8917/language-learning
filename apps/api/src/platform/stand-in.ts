// The start up check that every port resolves to its real implementation (I1). The stand ins
// in testing/ mark themselves; the runtime refuses to start when a marked port, or a mock
// gateway outside `AI_MODE=mock`, made it into the container. Tests build their apps with
// createContainer directly and may use stand ins.
import type { AiGateway } from '@app/ai';
import type { Ports } from '../ports';
import { ConfigError } from './config';

const STAND_IN = Symbol.for('app.standIn');

/** Marks a port object as a stand in (testing/ only). Returns the same object. */
export function markStandIn<T extends object>(label: string, port: T): T {
  Object.defineProperty(port, STAND_IN, { value: label, enumerable: false });
  return port;
}

/** True for a port made by a stand in factory. */
export function isStandIn(port: unknown): boolean {
  return typeof port === 'object' && port !== null && STAND_IN in port;
}

/** True for the mock gateway of @app/ai (it can be scripted; the real one cannot). */
export function isMockGateway(ai: AiGateway): boolean {
  const g = ai as Partial<Record<'script' | 'respond' | 'callsFor', unknown>>;
  return (
    typeof g.script === 'function' &&
    typeof g.respond === 'function' &&
    typeof g.callsFor === 'function'
  );
}

export type PortKind = 'real' | 'stand-in' | 'mock';

/** What each port of a container resolves to, in a fixed order. */
export function portReport(deps: { ports: Ports; ai: AiGateway }): Record<string, PortKind> {
  const out: Record<string, PortKind> = {};
  const names = ['morphology', 'dictionary', 'notes', 'attempts', 'analyzer'] as const;
  for (const name of names) out[name] = isStandIn(deps.ports[name]) ? 'stand-in' : 'real';
  out.gateway = isMockGateway(deps.ai) ? 'mock' : 'real';
  return out;
}

/**
 * Throws ConfigError unless every port is real. The gateway may be the mock only when the
 * config asks for it (`AI_MODE=mock`), and must be the mock then.
 */
export function assertRealPorts(
  deps: { ports: Ports; ai: AiGateway },
  aiMode: 'anthropic' | 'mock',
): Record<string, PortKind> {
  const report = portReport(deps);
  const wrong = Object.entries(report)
    .filter(([name, kind]) =>
      name === 'gateway' ? kind !== (aiMode === 'mock' ? 'mock' : 'real') : kind !== 'real',
    )
    .map(([name, kind]) => `${name} (${kind})`);
  if (wrong.length > 0)
    throw new ConfigError(
      `Refusing to start: these ports do not resolve to their real implementation: ${wrong.join(', ')}.`,
    );
  return report;
}
