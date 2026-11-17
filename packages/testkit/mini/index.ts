// Mini Slovak dataset (package F9): a small, hand checked content set of the 72 lemmas below.
// The files beside this module are a complete content set (docs/contracts.md, "Content files");
// `loadContent(db, MINI_DIR)` loads them, and `loadMini()` returns them parsed, from memory.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CONTENT_FILES,
  type ContentFileName,
  type ContentSet,
  type ExerciseRow,
  type FormMap,
  type FormRow,
  type LemmaRow,
  type LessonRow,
  MANIFEST_FILE,
  ManifestSchema,
  type PatternRow,
  type SentenceRow,
  type TriggerRow,
} from '@app/contracts';

/** Absolute path of the folder that holds the content files, with a trailing separator. */
export const MINI_DIR: string = fileURLToPath(new URL('.', import.meta.url));

/** The 72 lemma ids of the mini dataset (docs/work-packages.md, F9). They never change. */
export const MINI_LEMMA_IDS = {
  chlap: 1,
  kamarát: 2,
  brat: 3,
  hrdina: 4,
  dub: 5,
  dom: 6,
  obchod: 7,
  stroj: 8,
  počítač: 9,
  kuli: 10,
  žena: 11,
  kniha: 12,
  káva: 13,
  ulica: 14,
  práca: 15,
  dlaň: 16,
  kosť: 17,
  miestnosť: 18,
  gazdiná: 19,
  mesto: 20,
  kino: 21,
  srdce: 22,
  vysvedčenie: 23,
  námestie: 24,
  dievča: 25,
  múzeum: 26,
  človek: 27,
  ľudia: 28,
  rodič: 29,
  deň: 30,
  Bratislava: 31,
  pekný: 32,
  nový: 33,
  dobrý: 34,
  cudzí: 35,
  slovenský: 36,
  ja: 37,
  ty: 38,
  on: 39,
  ona: 40,
  môj: 41,
  ten: 42,
  kto: 43,
  čo: 44,
  do: 45,
  z: 46,
  od: 47,
  bez: 48,
  k: 49,
  v: 50,
  na: 51,
  o: 52,
  pri: 53,
  po: 54,
  s: 55,
  pre: 56,
  jeden: 57,
  dva: 58,
  päť: 59,
  byť: 60,
  mať: 61,
  ísť: 62,
  vidieť: 63,
  bývať: 64,
  pomáhať: 65,
  pracovať: 66,
  kúpiť: 67,
  a: 68,
  nie: 69,
  veľmi: 70,
  dnes: 71,
  kde: 72,
} as const;

/** The content set with lookup tables. */
export type MiniDataset = ContentSet & {
  lemmaById: ReadonlyMap<number, LemmaRow>;
  /** Every form of a lemma, in paradigm order. */
  formsByLemma: ReadonlyMap<number, readonly FormRow[]>;
  triggerById: ReadonlyMap<string, TriggerRow>;
  patternById: ReadonlyMap<string, PatternRow>;
  lessonById: ReadonlyMap<string, LessonRow>;
  exerciseById: ReadonlyMap<string, ExerciseRow>;
  sentenceById: ReadonlyMap<string, SentenceRow>;
};

type RowOf<F extends ContentFileName> = ReturnType<(typeof CONTENT_FILES)[F]['parse']>;

/** Reads one `.jsonl` file of a content folder and parses every row with its schema. */
export function readContentFile<F extends ContentFileName>(dir: string, file: F): RowOf<F>[] {
  const schema = CONTENT_FILES[file];
  const text = readFileSync(new URL(file, dirUrl(dir)), 'utf8');
  const rows: RowOf<F>[] = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const parsed = schema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(`${file}:${i + 1}: ${parsed.error.message}`);
    }
    rows.push(parsed.data as RowOf<F>);
  });
  return rows;
}

/** Reads and parses a whole content folder. */
export function readContentSet(dir: string): ContentSet {
  const manifest = ManifestSchema.parse(
    JSON.parse(readFileSync(new URL(MANIFEST_FILE, dirUrl(dir)), 'utf8')),
  );
  return {
    lemmas: readContentFile(dir, 'lemmas.jsonl'),
    forms: readContentFile(dir, 'forms.jsonl'),
    senses: readContentFile(dir, 'senses.jsonl'),
    sentences: readContentFile(dir, 'sentences.jsonl'),
    triggers: readContentFile(dir, 'triggers.jsonl'),
    patterns: readContentFile(dir, 'patterns.jsonl'),
    lessons: readContentFile(dir, 'lessons.jsonl'),
    exercises: readContentFile(dir, 'exercises.jsonl'),
    scenarios: readContentFile(dir, 'scenarios.jsonl'),
    library: readContentFile(dir, 'library.jsonl'),
    manifest,
  };
}

let cached: MiniDataset | undefined;

/** The mini dataset, parsed once and kept in memory. Treat it as read only. */
export function loadMini(): MiniDataset {
  if (cached) return cached;
  const set = readContentSet(MINI_DIR);
  const formsByLemma = new Map<number, FormRow[]>();
  for (const f of set.forms) {
    const list = formsByLemma.get(f.lemmaId) ?? [];
    list.push(f);
    formsByLemma.set(f.lemmaId, list);
  }
  cached = {
    ...set,
    lemmaById: new Map(set.lemmas.map((r) => [r.id, r])),
    formsByLemma,
    triggerById: new Map(set.triggers.map((r) => [r.id, r])),
    patternById: new Map(set.patterns.map((r) => [r.id, r])),
    lessonById: new Map(set.lessons.map((r) => [r.id, r])),
    exerciseById: new Map(set.exercises.map((r) => [r.id, r])),
    sentenceById: new Map(set.sentences.map((r) => [r.id, r])),
  };
  return cached;
}

/** Every form of a lemma mapped to its form tags, as `ExerciseItem.formMap` carries it. */
export function miniFormMap(lemmaId: number): FormMap {
  const map: FormMap = {};
  for (const f of loadMini().formsByLemma.get(lemmaId) ?? []) {
    map[f.form] = f.tags === '' ? [] : f.tags.split(' ');
  }
  return map;
}

function dirUrl(dir: string): URL {
  return pathToFileURL(dir.endsWith('/') ? dir : `${dir}/`);
}
