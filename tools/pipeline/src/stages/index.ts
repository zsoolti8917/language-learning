// Every stage of the pipeline, in run order (docs/architecture.md, "Stages"). A new stage is
// a folder under stages/ that exports a Stage; add it here, in its place in the order.
// The order also decides how validate assembles the parts of the set.
import type { Stage } from '../lib/runner';
import { dictStage } from './dict';
import { fetchStage } from './fetch';
import { freqStage } from './freq';
import { libraryStage } from './library';
import { loadStage } from './load';
import { morphStage } from './morph';
import { scenariosStage } from './scenarios';
import { validateStage } from './validate';

export const STAGES: readonly Stage[] = [
  fetchStage,
  morphStage,
  freqStage,
  dictStage,
  // C3: sentences · C4: triggers, lessons, exercises
  scenariosStage,
  libraryStage,
  validateStage,
  loadStage,
];

export function stageByName(name: string, stages: readonly Stage[] = STAGES): Stage | undefined {
  return stages.find((s) => s.name === name);
}
