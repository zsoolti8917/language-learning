// The default mock replays the contract examples, so the scheduler states in them must be
// states @app/srs reads (the review session schedules from them on the phone).
import { examples } from '@app/contracts';
import { parseSchedulerState, schedule } from '@app/srs';
import { describe, expect, it } from 'vitest';

function schedulerStates(value: unknown, path: string, out: [string, unknown][]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      schedulerStates(v, `${path}[${i}]`, out);
    });
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'scheduler' && v !== null) out.push([`${path}.${k}`, v]);
      else schedulerStates(v, `${path}.${k}`, out);
    }
  }
}

describe('contract examples', () => {
  const states: [string, unknown][] = [];
  schedulerStates(examples, 'examples', states);

  it('carry scheduler states', () => {
    expect(states.map(([p]) => p)).toEqual(
      expect.arrayContaining([expect.stringContaining('review.queue')]),
    );
  });

  it.each(states)('%s is a state @app/srs reads and schedules', (_path, value) => {
    const state = parseSchedulerState(value);
    const next = schedule(state, 3, new Date(state.dueAt), { desiredRetention: 0.9 });
    expect(next.state.reps).toBe(state.reps + 1);
  });
});
