// Every stand in passes the shared suite of its port. The five suites share one database.
import { afterAll, beforeAll } from 'vitest';
import { createSimpleAnalyzer } from './analyzer';
import { createMiniDictionary, createMiniMorphology } from './lexicon';
import { createAttemptsRecorder, createNotesRecorder } from './recorders';
import { runAnalyzerSuite } from './suites/analyzer';
import { runAttemptsSuite } from './suites/attempts';
import { createSuiteEnv, type SuiteEnv } from './suites/context';
import { runDictionarySuite } from './suites/dictionary';
import { runMorphologySuite } from './suites/morphology';
import { runNotesSuite } from './suites/notes';

let env: SuiteEnv;
beforeAll(async () => {
  env = await createSuiteEnv();
});
afterAll(() => env.close());
const shared = () => env;

runMorphologySuite('mini stand in', () => createMiniMorphology(), shared);
runDictionarySuite('mini stand in', () => createMiniDictionary(), shared);
runNotesSuite('recorder', (ctx) => createNotesRecorder(ctx.ids), shared);
runAttemptsSuite('recorder', () => createAttemptsRecorder(), shared);
runAnalyzerSuite(
  'simple stand in',
  () =>
    createSimpleAnalyzer({ morphology: createMiniMorphology, dictionary: createMiniDictionary }),
  shared,
);
