import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathsFor } from '../lib/paths';
import type { ArgValue, StageContext } from '../lib/runner';
import { answeredByOf, fillAlwaysRuns, fillModeOf, runOptionsOf } from './options';
import { OFFLINE_MODEL } from './runner';

const paths = pathsFor('/repo');
const ctx = (args: Record<string, ArgValue>): StageContext => ({
  paths,
  args,
  log: () => undefined,
  now: () => new Date(0),
  stages: [],
});

describe('fill options', () => {
  it('reads --fill and refuses a mode it does not know', () => {
    expect(fillModeOf(ctx({}))).toBe('none');
    expect(fillModeOf(ctx({ fill: 'offline' }))).toBe('offline');
    expect(() => fillModeOf(ctx({ fill: 'paid' }))).toThrow(/--fill must be/u);
  });

  it('gives no run options without a fill', () => {
    expect(runOptionsOf(ctx({}), 'dict')).toBeNull();
  });

  it('keeps mock answers in a cache of their own', () => {
    expect(runOptionsOf(ctx({ fill: 'mock' }), 'dict')?.cacheDir).toBe(
      join(paths.build, 'model-cache-mock'),
    );
    expect(runOptionsOf(ctx({ fill: 'live' }), 'dict')?.cacheDir).toBe(
      join(paths.build, 'model-cache'),
    );
  });

  it('gives an offline fill the folders of its stage and the name of the writer', () => {
    const o = runOptionsOf(ctx({ fill: 'offline', 'answered-by': 'a-writer' }), 'sentences');
    expect(o).toMatchObject({
      mode: 'offline',
      cacheDir: join(paths.build, 'model-cache'),
      requestsDir: join(paths.build, 'model-requests', 'sentences'),
      answersDir: join(paths.build, 'model-answers', 'sentences'),
      answeredBy: 'a-writer',
    });
    expect(runOptionsOf(ctx({ fill: 'offline' }), 'dict')?.answeredBy).toBe(OFFLINE_MODEL);
    expect(runOptionsOf(ctx({ fill: 'live' }), 'dict')).not.toHaveProperty('requestsDir');
  });

  it('refuses a writer name that could not be a file or a label', () => {
    expect(answeredByOf(ctx({ 'answered-by': 'writer_1.b-2' }))).toBe('writer_1.b-2');
    expect(() => answeredByOf(ctx({ 'answered-by': 'a writer' }))).toThrow(/--answered-by/u);
    expect(() => answeredByOf(ctx({ 'answered-by': '' }))).toThrow(/--answered-by/u);
  });

  it('reaches the model step on every dry, live and offline run', () => {
    expect(fillAlwaysRuns(ctx({}))).toBe(false);
    expect(fillAlwaysRuns(ctx({ fill: 'mock' }))).toBe(false);
    expect(fillAlwaysRuns(ctx({ fill: 'dry-run' }))).toBe(true);
    expect(fillAlwaysRuns(ctx({ fill: 'live' }))).toBe(true);
    expect(fillAlwaysRuns(ctx({ fill: 'offline' }))).toBe(true);
  });
});
