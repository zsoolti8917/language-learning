// Helpers for the pipeline's tests: a throwaway repository root and a stage context on it.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAGES } from '../stages';
import { type Paths, pathsFor } from './paths';
import type { ArgValue, Stage, StageContext } from './runner';

export interface TempRoot {
  root: string;
  paths: Paths;
  ctx(args?: Record<string, ArgValue>, stages?: readonly Stage[]): StageContext;
  logs: string[];
  remove(): Promise<void>;
}

export const FIXED_NOW = new Date('2026-11-17T12:00:00.000Z');

export async function tempRoot(): Promise<TempRoot> {
  const root = await mkdtemp(join(tmpdir(), 'pipeline-'));
  const paths = pathsFor(root);
  const logs: string[] = [];
  return {
    root,
    paths,
    logs,
    ctx: (args = {}, stages = STAGES) => ({
      paths,
      args,
      log: (m) => logs.push(m),
      now: () => FIXED_NOW,
      stages,
    }),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
