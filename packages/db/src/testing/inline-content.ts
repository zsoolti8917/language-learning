// A small content set written inline, for the loader tests. Every file has a few rows.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const INLINE_CONTENT = {
  lemmas: [
    {
      id: 20,
      key: 'mesto|noun|n|1',
      lemma: 'mesto',
      pos: 'noun',
      gender: 'n',
      pattern: 'mesto',
      freqRank: 152,
      topForms: [{ form: 'meste', tag: 's6', share: 0.3 }],
    },
    { id: 45, key: 'do|prep||1', lemma: 'do', pos: 'prep', freqRank: 20 },
    { id: 62, key: 'ísť|verb||1', lemma: 'ísť', pos: 'verb', aspect: 'ipf', freqRank: 60 },
    { id: 29, key: 'rodič|noun|m_anim|1', lemma: 'rodič', pos: 'noun', gender: 'm_anim' },
  ],
  forms: [
    { lemmaId: 20, form: 'mesto', tags: 's1 s4 s5' },
    { lemmaId: 20, form: 'mesta', tags: 's2' },
    { lemmaId: 20, form: 'meste', tags: 's6' },
    { lemmaId: 20, form: 'mestá', tags: 'p1 p4 p5' },
    { lemmaId: 45, form: 'do', tags: '' },
    { lemmaId: 62, form: 'idem', tags: 'v:Kesa+' },
    { lemmaId: 29, form: 'Rodič', tags: 's1' },
  ],
  senses: [
    { lemmaId: 20, ord: 0, glossEn: 'town, city', source: 'wiktionary', verified: true },
    { lemmaId: 45, ord: 0, glossEn: 'to, into', source: 'manual' },
  ],
  sentences: [
    {
      id: 'tat-482913',
      textSk: 'Idem do mesta.',
      textEn: 'I am going to town.',
      tokens: [
        { s: 0, e: 4, lemmaId: 62, tag: 'v:Kesa+' },
        { s: 5, e: 7, lemmaId: 45 },
        { s: 8, e: 13, lemmaId: 20, tag: 's2' },
        { s: 13, e: 14 },
      ],
      difficulty: 0.1,
      source: 'tatoeba',
      license: 'CC BY 2.0 FR',
      links: [
        { lemmaId: 20, tokenIndex: 2, form: 'mesta', tag: 's2', ord: 0 },
        { lemmaId: 45, tokenIndex: 1, form: 'do', tag: '', ord: 0 },
      ],
    },
  ],
  triggers: [
    {
      id: 'prep-do',
      kind: 'preposition',
      lemma: 'do',
      lemmaId: 45,
      case: 'gen',
      meaningEn: 'to, into',
      exampleSk: 'Idem do mesta.',
      exampleEn: 'I am going to town.',
    },
  ],
  patterns: [
    {
      id: 'mesto',
      labelSk: 'mesto',
      pos: 'noun',
      gender: 'n',
      modelLemmaId: 20,
      endings: { s1: 'o', s2: 'a', s6: 'e', p1: 'á' },
    },
  ],
  lessons: [
    {
      id: 'gen-sg',
      ord: 3,
      titleEn: 'Genitive singular',
      titleSk: 'Genitív jednotného čísla',
      case: 'gen',
      number: 'sg',
      focus: { buckets: [{ case: 'gen', number: 'sg', gender: 'n', weight: 1 }], triggerIds: [] },
      summaryMd: 'After *do*, the genitive.',
      steps: [
        { ord: 0, kind: 'triggers', content: { kind: 'triggers', triggerIds: ['prep-do'] } },
        { ord: 1, kind: 'triggers', content: { kind: 'triggers', triggerIds: ['prep-do'] } },
      ],
    },
  ],
  exercises: [
    {
      id: 'ex-7b21c0d4e9',
      kind: 'cloze',
      sentenceSk: 'Idem do mesta.',
      sentenceEn: 'I am going to town.',
      target: { start: 8, end: 13, lemmaIds: [20], cue: 'mesto', answers: ['mesta'] },
      case: 'gen',
      number: 'sg',
      gender: 'n',
      pattern: 'mesto',
      triggerId: 'prep-do',
      lessonId: 'gen-sg',
      difficulty: 0.2,
      source: 'authored',
    },
  ],
  scenarios: [
    {
      id: 'scn-city-trip',
      mode: 'scenario',
      titleEn: 'A trip to town',
      titleSk: 'Výlet do mesta',
      goalEn: 'Say where you are going.',
      settingSk: 'Na stanici.',
      tutorRole: 'a friend',
      targetCases: ['gen'],
      targetTriggers: ['prep-do'],
      level: 'A2',
      openingSk: 'Kam ideš?',
      successCriteria: [{ id: 'dest', textEn: 'Names the destination' }],
      ord: 0,
    },
  ],
  library: [
    {
      id: 'lib-001',
      title: 'Do mesta',
      body: 'Idem do mesta.',
      level: 'A2',
      lemmaCounts: { '20': 1, '45': 1, '62': 1 },
      source: 'authored',
      license: 'CC0',
      ord: 0,
    },
  ],
} as const;

export const INLINE_MANIFEST = {
  version: '2026-12-01.1',
  builtAt: '2026-12-01T06:00:00.000Z',
  sources: [{ name: 'inline', url: '', checksum: 'sha256:00', license: 'CC0' }],
  counts: { lemmas: 4, forms: 7, sentences: 1 },
};

type Rows = Record<string, readonly unknown[]>;

/** Writes a content set to a new temporary folder and returns its path. */
export function writeContentSet(
  rows: Rows = INLINE_CONTENT,
  manifest: unknown = INLINE_MANIFEST,
  dir: string = mkdtempSync(join(tmpdir(), 'f3-content-')),
): string {
  for (const [name, list] of Object.entries(rows))
    writeFileSync(join(dir, `${name}.jsonl`), `${list.map((r) => JSON.stringify(r)).join('\n')}\n`);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}
