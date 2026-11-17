// Clock and IdGenerator: the only sources of time and ids. Tests swap in fixed ones.
import { v7 as uuidv7 } from 'uuid';
import type { Clock, IdGenerator } from '../ports';

export const systemClock: Clock = { now: () => new Date() };

/** A clock that stands still until a test moves it. */
export interface FixedClock extends Clock {
  set(at: Date | string): void;
  advance(ms: number): void;
}

export function createFixedClock(start: Date | string = '2026-11-17T08:30:00.000Z'): FixedClock {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    set: (at) => {
      t = new Date(at).getTime();
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** UUID v7: ids sort by creation time. */
export const uuidV7Ids: IdGenerator = { uuid: () => uuidv7() };

/** Predictable ids for tests: `00000000-0000-7000-8000-000000000001`, …02, … */
export function createSequentialIds(prefix = '00000000'): IdGenerator {
  let n = 0;
  return {
    uuid: () => {
      n += 1;
      return `${prefix}-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
    },
  };
}
