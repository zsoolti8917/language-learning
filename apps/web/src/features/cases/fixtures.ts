// Data for the mock server and the tests of this feature. Contract examples are reused as is;
// the extra items and tables are copied from the mini dataset (packages/testkit/mini: forms,
// patterns, triggers and lessons files), so every Slovak form here is real.
import {
  type Course,
  type ExerciseItem,
  examples,
  type FormMap,
  type LessonDetail,
  type TrainerSession,
} from '@app/contracts';

const SESSION_EXAMPLE = examples['declension.createSession'].ok[0]?.response.body as TrainerSession;
const LESSON_EXAMPLE = examples['declension.lesson'].ok[0]?.response.body as LessonDetail;
const COURSE_EXAMPLE = examples['declension.course'].ok[0]?.response.body as Course;

function byId(items: ExerciseItem[], id: string): ExerciseItem {
  const item = items.find((i) => i.exerciseId === id);
  if (!item) throw new Error(`no example item ${id}`);
  return item;
}

const LESSON_ITEMS = LESSON_EXAMPLE.steps.flatMap((s) => s.exercises);

/** Idem do mesta. (cloze, do + genitive) */
export const EX_MESTA = byId(SESSION_EXAMPLE.items, 'ex-7b21c0d4e9');
/** Dnes som v kine. (choice_form, v + locative) */
export const EX_KINE = byId(SESSION_EXAMPLE.items, 'ex-9d04b3e2f1');
/** Pomáham bratovi. (cloze, pomáhať + dative) */
export const EX_BRATOVI = byId(SESSION_EXAMPLE.items, 'ex-b4e1f09a37');
/** Kúpim knihu. (cloze, accusative) */
export const EX_KNIHU = byId(LESSON_ITEMS, 'ex-3fa94c21d0');
/** Vidím ženu. (choice_form, accusative) */
export const EX_ZENU = byId(LESSON_ITEMS, 'ex-5c2e81b7a4');

/** ulica, lemma 14 of the mini dataset. */
export const FORMS_ULICA: FormMap = {
  ulica: ['s1', 's5'],
  ulice: ['s2', 'p1', 'p4', 'p5'],
  ulici: ['s3', 's6'],
  ulicu: ['s4'],
  ulicou: ['s7'],
  ulíc: ['p2'],
  uliciam: ['p3'],
  uliciach: ['p6'],
  ulicami: ['p7'],
};

/** žena, lemma 11 of the mini dataset. */
export const FORMS_ZENA: FormMap = {
  žena: ['s1', 's5'],
  ženy: ['s2', 'p1', 'p4', 'p5'],
  žene: ['s3', 's6'],
  ženu: ['s4'],
  ženou: ['s7'],
  žien: ['p2'],
  ženám: ['p3'],
  ženách: ['p6'],
  ženami: ['p7'],
};

const Z_ULICE = 'Idem z ulice domov.';
/** z + genitive of a soft feminine noun: the place for "z ulicy". */
export const EX_ULICE: ExerciseItem = {
  exerciseId: 'ex-m4-ulice',
  kind: 'cloze',
  sentenceSk: Z_ULICE,
  sentenceEn: 'I am going home from the street.',
  blank: { start: Z_ULICE.indexOf('ulice'), end: Z_ULICE.indexOf('ulice') + 'ulice'.length },
  cue: 'ulica',
  answers: ['ulice'],
  features: { case: 'gen', number: 'sg', gender: 'f', pattern: 'ulica' },
  trigger: { id: 'prep-z', kind: 'preposition', label: 'z + genitive' },
  formMap: FORMS_ULICA,
  // The s2 ending of each feminine pattern (patterns.jsonl).
  siblingEndings: { zena: 'y', ulica: 'e', dlan: 'e', kost: 'i', gazdina: 'ej' },
};

const POMAHAM_ZENAM = 'Pomáham ženám.';
/** pomáhať + dative plural: the place for "zenam". */
export const EX_ZENAM: ExerciseItem = {
  exerciseId: 'ex-m4-zenam',
  kind: 'cloze',
  sentenceSk: POMAHAM_ZENAM,
  sentenceEn: 'I help the women.',
  blank: {
    start: POMAHAM_ZENAM.indexOf('ženám'),
    end: POMAHAM_ZENAM.indexOf('ženám') + 'ženám'.length,
  },
  cue: 'žena',
  answers: ['ženám'],
  features: { case: 'dat', number: 'pl', gender: 'f', pattern: 'zena' },
  trigger: { id: 'verb-pomahat', kind: 'verb', label: 'pomáhať + dative' },
  formMap: FORMS_ZENA,
  // The p3 ending of each feminine pattern (patterns.jsonl).
  siblingEndings: { zena: 'ám', ulica: 'iam', dlan: 'iam', kost: 'iam', gazdina: 'ám' },
};

/** The items the mock trainer hands out, in this order (sliced to the session size). */
export const TRAINER_POOL: ExerciseItem[] = [
  EX_MESTA,
  EX_ULICE,
  EX_ZENAM,
  EX_KINE,
  EX_BRATOVI,
  EX_KNIHU,
  EX_ZENU,
];

export const SESSION_ID = SESSION_EXAMPLE.sessionId;

/** The whole course of nine lessons (lessons.jsonl), with statuses for the mock. */
export const COURSE: Course = {
  lessons: [
    ['acc-sg', 'Accusative singular', 'Akuzatív jednotného čísla', 'acc', 'sg', 'completed'],
    ['loc-sg', 'Locative singular', 'Lokál jednotného čísla', 'loc', 'sg', 'in_progress'],
    ['gen-sg', 'Genitive singular', 'Genitív jednotného čísla', 'gen', 'sg', 'available'],
    ['ins-sg', 'Instrumental singular', 'Inštrumentál jednotného čísla', 'ins', 'sg', 'available'],
    ['dat-pron', 'Dative, starting with pronouns', 'Datív, najprv zámená', 'dat', null, 'locked'],
    [
      'nom-acc-pl',
      'Nominative and accusative plural',
      'Nominatív a akuzatív množného čísla',
      null,
      'pl',
      'locked',
    ],
    [
      'loc-ins-dat-pl',
      'Locative, instrumental and dative plural',
      'Lokál, inštrumentál a datív množného čísla',
      null,
      'pl',
      'locked',
    ],
    ['gen-pl', 'Genitive plural', 'Genitív množného čísla', 'gen', 'pl', 'locked'],
    ['mixed', 'All cases together', 'Všetky pády', null, null, 'available'],
  ].map(([id, titleEn, titleSk, c, n, status], i) => ({
    id: id as string,
    ord: i + 1,
    titleEn: titleEn as string,
    titleSk: titleSk as string,
    case: c as Course['lessons'][number]['case'],
    number: n as Course['lessons'][number]['number'],
    status: status as Course['lessons'][number]['status'],
    score: status === 'completed' ? { correct: 7, total: 8 } : null,
  })),
  mastery: [
    ...COURSE_EXAMPLE.mastery,
    { case: 'acc', number: 'sg', gender: 'm_anim', attempts: 22, mastery: 0.78, level: 'ok' },
    { case: 'acc', number: 'sg', gender: 'm_inan', attempts: 12, mastery: 0.88, level: 'strong' },
    { case: 'loc', number: 'sg', gender: 'f', attempts: 9, mastery: 0.44, level: 'weak' },
    { case: 'gen', number: 'sg', gender: 'n', attempts: 6, mastery: 0.41, level: 'weak' },
    { case: 'dat', number: 'sg', gender: 'm_anim', attempts: 3, mastery: 0.5, level: 'unseen' },
    { case: 'ins', number: 'sg', gender: 'm_inan', attempts: 10, mastery: 0.7, level: 'ok' },
  ],
};

/** The example lesson (acc-sg), started fresh: no progress yet. */
export const LESSON_ACC_SG: LessonDetail = { ...LESSON_EXAMPLE, progress: null };
