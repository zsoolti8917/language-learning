// Every stage of the pipeline, in run order (docs/architecture.md, "Stages"). A new stage is
// a folder under stages/ that exports a Stage; add it here, in its place in the order.
// The order also decides how validate assembles the parts of the set.
import type { Stage } from '../lib/runner';
import { dictStage } from './dict';
import { exercisesStage } from './exercises';
import { fetchStage } from './fetch';
import { freqStage } from './freq';
import { lessonsStage } from './lessons';
import { loadStage } from './load';
import { morphStage } from './morph';
import { triggersStage } from './triggers';
import { validateStage } from './validate';

export const STAGES: readonly Stage[] = [
  fetchStage,
  morphStage,
  freqStage,
  dictStage,
  // C3: sentences
  triggersStage,
  lessonsStage,
  exercisesStage,
  // C5: scenarios, library
  validateStage,
  loadStage,
];

export function stageByName(name: string, stages: readonly Stage[] = STAGES): Stage | undefined {
  return stages.find((s) => s.name === name);
}
