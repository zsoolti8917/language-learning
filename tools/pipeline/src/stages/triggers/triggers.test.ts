import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TriggerRow } from '@app/contracts';
import { MINI_DIR } from '@app/testkit/mini';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl, writeJsonl } from '../../lib/files';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { validateSet } from '../../lib/validate';
import {
  type AuthoredTrigger,
  buildTriggers,
  readAuthoredTriggers,
  readTriggerRows,
  triggerCasesCheck,
  triggersOut,
  triggersStage,
} from '.';
import { loadMorphology, type Morphology } from './morphology';

const AUTHORED = fileURLToPath(new URL('../../../../../content/authored', import.meta.url));

type Row = Record<string, unknown>;
async function rows(path: string): Promise<Row[]> {
  const out: Row[] = [];
  for await (const r of readJsonl<Row>(path)) out.push(r);
  return out;
}

/** The cases each preposition takes in the full morphology (morph flags.cases). */
const PREP_CASES: Record<string, string[]> = {
  do: ['gen'],
  z: ['gen'],
  od: ['gen'],
  bez: ['gen'],
  k: ['dat'],
  v: ['acc', 'loc'],
  na: ['acc', 'loc'],
  o: ['acc', 'loc'],
  pri: ['loc'],
  po: ['acc', 'loc'],
  s: ['ins'],
  pre: ['acc'],
};

/** A copy of the mini lemmas with flags.cases on the prepositions, as a full build has. */
async function withPrepCases(dir: string, cases = PREP_CASES): Promise<string> {
  await mkdir(dir, { recursive: true });
  const lemmas = (await rows(join(MINI_DIR, 'lemmas.jsonl'))).map((l) =>
    l.pos === 'prep' && cases[String(l.lemma)]
      ? { ...l, flags: { ...(l.flags as object), cases: cases[String(l.lemma)] } }
      : l,
  );
  await writeJsonl(join(dir, 'lemmas.jsonl'), lemmas);
  await cp(join(MINI_DIR, 'forms.jsonl'), join(dir, 'forms.jsonl'));
  return dir;
}

const morphOf = async (dir: string, complete = false): Promise<Morphology> =>
  loadMorphology(
    { lemmas: join(dir, 'lemmas.jsonl'), forms: join(dir, 'forms.jsonl'), complete },
    { formsFor: () => true, words: true },
  );

describe('the authored triggers', () => {
  let authored: AuthoredTrigger[];
  beforeAll(async () => {
    authored = await readAuthoredTriggers(join(AUTHORED, 'triggers'));
  });

  it('are about 200, with every kind and unique ids', () => {
    expect(authored.length).toBeGreaterThanOrEqual(190);
    expect(new Set(authored.map((t) => t.id)).size).toBe(authored.length);
    expect(new Set(authored.map((t) => t.kind))).toEqual(
      new Set(['preposition', 'verb', 'numeral', 'quantifier', 'noun', 'adjective', 'question']),
    );
  });

  it('keep every trigger id of the mini dataset', async () => {
    const ids = new Set(authored.map((t) => t.id));
    const mini = await rows(join(MINI_DIR, 'triggers.jsonl'));
    expect(mini.map((t) => t.id).filter((id) => !ids.has(String(id)))).toEqual([]);
  });

  it('agree with the cases of the prepositions in the morphology', async () => {
    const t = await tempRoot();
    try {
      const m = await morphOf(await withPrepCases(join(t.root, 'm')));
      const built = buildTriggers(m, authored);
      expect(built.problems).toEqual([]);
    } finally {
      await t.remove();
    }
  });
});

describe('the triggers stage', () => {
  let t: TempRoot;
  beforeAll(async () => {
    t = await tempRoot();
    await cp(AUTHORED, join(t.paths.content, 'authored'), { recursive: true });
  });
  afterAll(() => t.remove());

  it('builds the triggers on the mini dataset, with words it lacks as warnings', async () => {
    await runStage(triggersStage, t.ctx({ morph: MINI_DIR }));
    const out = await readTriggerRows(triggersOut(t.ctx()));
    expect(out.length).toBeGreaterThanOrEqual(190);
    const s = out.find((r) => r.id === 'prep-s-ins') as TriggerRow;
    expect(s).toMatchObject({ kind: 'preposition', lemma: 's', case: 'ins', lemmaId: 55 });
    // Verbs the mini dataset lacks have no lemma id; that is a note, not a failure.
    const report = JSON.parse(
      await readFile(join(t.paths.build, 'triggers', 'report.json'), 'utf8'),
    );
    expect(report.problems).toEqual([]);
    expect(report.notes.length).toBeGreaterThan(0);
  });

  it('fails the build when a preposition trigger has a case the morphology does not give it', async () => {
    const m = await morphOf(await withPrepCases(join(t.root, 'cases')));
    const wrong: AuthoredTrigger = {
      id: 'prep-s-gen',
      kind: 'preposition',
      lemma: 's',
      case: 'gen',
      meaningEn: 'from',
      exampleSk: 'Som s mestom.',
      exampleEn: 'I am with the town.',
    };
    const built = buildTriggers(m, [wrong]);
    expect(built.problems).toContain(
      'trigger prep-s-gen: s takes ins in the morphology, not the gen',
    );
    expect(built.problems).toContain(
      'preposition s takes the ins in the morphology, but no trigger has it',
    );

    // The stage throws on it, too.
    const dir = join(t.root, 'bad-authored');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'x.yaml'),
      'kind: preposition\ntriggers:\n  - id: prep-s-gen\n    lemma: s\n    case: gen\n    meaningEn: from\n    exampleSk: Som s mestom.\n    exampleEn: I am with the town.\n',
    );
    const t2 = await tempRoot();
    try {
      await cp(dir, join(t2.paths.content, 'authored', 'triggers'), { recursive: true });
      await expect(
        runStage(triggersStage, t2.ctx({ morph: join(t.root, 'cases') })),
      ).rejects.toThrow(/s takes ins in the morphology, not the gen/u);
    } finally {
      await t2.remove();
    }
  });

  it('has a validate check that reports the same mismatch in a content set', async () => {
    const dir = join(t.root, 'set');
    await cp(MINI_DIR, dir, { recursive: true });
    await withPrepCases(join(t.root, 'set-m'));
    await cp(join(t.root, 'set-m', 'lemmas.jsonl'), join(dir, 'lemmas.jsonl'));
    // The triggers the stage built (the mini set has only some cases of o and po).
    await cp(triggersOut(t.ctx()), join(dir, 'triggers.jsonl'));
    const good = await validateSet(dir, [triggerCasesCheck]);
    expect(good.issues).toEqual([]);
    const triggers = await rows(join(dir, 'triggers.jsonl'));
    await writeJsonl(
      join(dir, 'triggers.jsonl'),
      triggers.map((r) => (r.id === 'prep-s-ins' ? { ...r, case: 'gen' } : r)),
    );
    const bad = await validateSet(dir, [triggerCasesCheck]);
    expect(bad.issues.map((i) => i.message)).toEqual([
      expect.stringMatching(
        /^triggers\.jsonl:\d+ \(prep-s-ins\): s takes ins in the morphology, not the gen$/u,
      ),
      'preposition s (55) takes the ins, but no trigger has it',
    ]);
  });
});
