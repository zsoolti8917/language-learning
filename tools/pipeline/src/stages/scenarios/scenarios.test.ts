import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ScenarioRow, ScenarioRowSchema } from '@app/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl } from '../../lib/files';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { seedLibrarySample } from '../library/sample';
import { parseScenario, scenarioProblems, scenariosStage } from '.';
import { type KnownTrigger, TRIGGER_ID, triggerIdProblems } from './triggers';

async function rows<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for await (const r of readJsonl<T>(path)) out.push(r);
  return out;
}

describe('trigger ids', () => {
  it('follow kind-word[-case]', () => {
    for (const id of ['prep-do', 'prep-na-acc', 'verb-pomahat', 'num-pat', 'q-s-kym', 'q-koho-acc'])
      expect(TRIGGER_ID.test(id), id).toBe(true);
    for (const id of ['do', 'prep_na', 'prep-Na', 'prep-ná', 'preposition-do', 'prep-'])
      expect(TRIGGER_ID.test(id), id).toBe(false);
  });

  it('agree with the kind and the case of the trigger they name', () => {
    const known: KnownTrigger = {
      id: 'prep-v-acc',
      kind: 'preposition',
      case: 'loc',
      from: 'test',
    };
    expect(triggerIdProblems('prep-v-acc', known)).toEqual([
      'trigger "prep-v-acc" ends in -acc but governs the loc',
    ]);
    expect(triggerIdProblems('verb-v', { ...known, id: 'verb-v' })).toEqual([
      'trigger "verb-v" is a preposition, so its id starts with prep-',
    ]);
    expect(triggerIdProblems('prep-v-loc', { ...known, id: 'prep-v-loc' })).toEqual([]);
  });
});

describe('scenarios on the authored files', () => {
  let t: TempRoot;
  const out = () => join(t.paths.build, 'scenarios', 'scenarios.jsonl');
  const authored = () => join(t.paths.content, 'authored', 'scenarios');

  beforeAll(async () => {
    t = await tempRoot();
    await seedLibrarySample(t.paths);
  }, 60_000);
  afterAll(() => t.remove());

  it('writes 8 goal based scenarios and 4 case coach sets with every field of ling.scenario', async () => {
    await runStage(scenariosStage, t.ctx());
    const list = await rows<ScenarioRow>(out());
    expect(list.map((r) => r.id)).toEqual([
      'scn-cafe-order',
      'scn-asking-way',
      'scn-doctor',
      'scn-groceries',
      'scn-flat-rent',
      'scn-train-station',
      'scn-neighbour',
      'scn-weekend',
      'scn-coach-acc',
      'scn-coach-na-v',
      'scn-coach-gen',
      'scn-coach-ins',
    ]);
    expect(list.filter((r) => r.mode === 'scenario')).toHaveLength(8);
    expect(list.filter((r) => r.mode === 'case_coach')).toHaveLength(4);
    for (const r of list) {
      expect(ScenarioRowSchema.strict().parse(r), r.id).toEqual(r);
      for (const k of [
        'titleEn',
        'titleSk',
        'goalEn',
        'settingSk',
        'tutorRole',
        'openingSk',
      ] as const)
        expect(r[k].trim(), `${r.id}.${k}`).not.toBe('');
      expect(r.targetCases.length, r.id).toBeGreaterThan(0);
      expect(r.successCriteria.length, r.id).toBeGreaterThanOrEqual(3);
      expect(r.successCriteria.length, r.id).toBeLessThanOrEqual(4);
      expect(r.vocabHint.length, r.id).toBeGreaterThanOrEqual(3);
      expect(['A2', 'B1']).toContain(r.level);
    }
    // The case coach sets: accusative, na and v, the genitive after do, z, od, s + instrumental.
    const coach = Object.fromEntries(
      list.filter((r) => r.mode === 'case_coach').map((r) => [r.id, r]),
    );
    expect(coach['scn-coach-acc']?.targetCases).toEqual(['acc']);
    expect(coach['scn-coach-na-v']?.targetTriggers).toEqual(
      expect.arrayContaining(['prep-na-acc', 'prep-na-loc', 'prep-v-loc', 'prep-v-acc']),
    );
    expect(coach['scn-coach-gen']?.targetTriggers).toEqual(['prep-do', 'prep-z', 'prep-od']);
    expect(coach['scn-coach-ins']?.targetTriggers).toContain('prep-s-ins');
  }, 60_000);

  it('names only triggers that follow the convention, exist in the mini dataset and govern a target case', async () => {
    const mini = new Map<string, { case: string }>();
    for (const r of await rows<{ id: string; case: string }>(join(t.paths.mini, 'triggers.jsonl')))
      mini.set(r.id, r);
    for (const r of await rows<ScenarioRow>(out()))
      for (const id of r.targetTriggers) {
        expect(TRIGGER_ID.test(id), `${r.id}: ${id}`).toBe(true);
        const trig = mini.get(id);
        expect(trig, `${r.id}: ${id}`).toBeDefined();
        expect(r.targetCases, `${r.id}: ${id}`).toContain(trig?.case);
      }
  });

  it("accepts a trigger from C4's authored list and refuses one that is nowhere", async () => {
    const file = join(authored(), 'scn-weekend.yaml');
    const before = await readFile(file, 'utf8');
    const triggers = join(t.paths.content, 'authored', 'triggers');
    try {
      await mkdir(triggers, { recursive: true });
      await writeFile(
        join(triggers, 'verbs.yaml'),
        'triggers:\n  - id: verb-potrebovat\n    kind: verb\n    lemma: potrebovať\n    case: acc\n',
      );
      await writeFile(
        file,
        before.replace('targetTriggers: [', 'targetTriggers: [verb-potrebovat, '),
      );
      await runStage(scenariosStage, t.ctx());
      const weekend = (await rows<ScenarioRow>(out())).find((r) => r.id === 'scn-weekend');
      expect(weekend?.targetTriggers[0]).toBe('verb-potrebovat');

      await writeFile(file, before.replace('targetTriggers: [', 'targetTriggers: [verb-nikde, '));
      await expect(runStage(scenariosStage, t.ctx())).rejects.toThrow(/1 problems/);
      expect(t.logs.at(-1)).toBe(
        'scenarios: scn-weekend: trigger "verb-nikde" is neither in the mini dataset nor in C4\'s list',
      );
    } finally {
      await writeFile(file, before);
      await rm(triggers, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses malformed files and scenarios that break the rules', async () => {
    const yaml = await readFile(join(authored(), 'scn-coach-ins.yaml'), 'utf8');
    expect(() => parseScenario('scn-coach-ins.yaml', `${yaml}author: x\n`)).toThrow(/author/);
    expect(() => parseScenario('scn-other.yaml', yaml)).toThrow(/file name must be the id/);
    expect(() =>
      parseScenario('scn-coach-ins.yaml', yaml.replace('mode: case_coach', 'mode: chat')),
    ).toThrow(/mode/);
    const row = parseScenario('scn-coach-ins.yaml', yaml);
    const triggers = new Map<string, KnownTrigger>([
      ['prep-s-ins', { id: 'prep-s-ins', kind: 'preposition', case: 'ins', from: 'test' }],
      ['q-s-kym', { id: 'q-s-kym', kind: 'question', case: 'ins', from: 'test' }],
    ]);
    expect(scenarioProblems(row, triggers)).toEqual({ shape: [], triggers: [] });
    const broken: ScenarioRow = {
      ...row,
      targetCases: ['gen'],
      targetTriggers: ['prep-s-ins', 'prep-s-ins', 'q_s_kym'],
      successCriteria: [
        { id: 'c1', textEn: 'One.' },
        { id: 'c1', textEn: 'Two.' },
      ],
      vocabHint: [],
    };
    expect(scenarioProblems(broken, triggers)).toEqual({
      shape: [
        '2 success criteria, not 3 or 4',
        'success criterion id "c1" is used twice',
        '0 vocabulary hints, fewer than 3',
      ],
      triggers: [
        'target trigger prep-s-ins is listed twice',
        'trigger "prep-s-ins" governs the ins, which is not a target case',
        'trigger "prep-s-ins" governs the ins, which is not a target case',
        'trigger "q_s_kym" does not follow the id convention (kind-word[-case], e.g. prep-na-acc)',
        'trigger "q_s_kym" is neither in the mini dataset nor in C4\'s list',
      ],
    });
  });
});
