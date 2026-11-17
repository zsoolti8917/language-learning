// Building blocks of the example payloads: fixed ids, times, tables of forms and exercises.
// Every Slovak word here is a form of one of the 72 mini dataset lemmas.
import type { z } from 'zod';
import type { FormMap, Span } from '../common';
import type {
  CardSnapshotSchema,
  ExerciseItemSchema,
  NoteDetailSchema,
  ProfileSchema,
  TextAnalysisSchema,
  TutorErrorSchema,
} from '../entities';

/** A fixed UUID version 7 per example row, so examples link to each other. */
function uuid7(n: number): string {
  return `0193a1b2-c3d4-7e5f-8a6b-${n.toString(16).padStart(12, '0')}`;
}

export const IDS = {
  user: uuid7(1),
  noteMesto: uuid7(0x10),
  cardMesto: uuid7(0x11),
  noteKniha: uuid7(0x12),
  cardKniha: uuid7(0x13),
  notePhrase: uuid7(0x14),
  noteCase: uuid7(0x15),
  cardCase: uuid7(0x16),
  review1: uuid7(0x20),
  review2: uuid7(0x21),
  text: uuid7(0x30),
  libraryText: uuid7(0x31),
  placement: uuid7(0x40),
  session: uuid7(0x50),
  attempt1: uuid7(0x51),
  attempt2: uuid7(0x52),
  conversation: uuid7(0x60),
  tutorMessage0: uuid7(0x61),
  learnerMessage1: uuid7(0x62),
  tutorMessage2: uuid7(0x63),
  tutorError: uuid7(0x64),
  report: uuid7(0x70),
} as const;

export const NOW = '2026-11-17T08:30:00.000Z';
export const EARLIER = '2026-11-16T19:05:00.000Z';
export const CREATED = '2026-11-01T10:00:00.000Z';
export const TOMORROW = '2026-11-18T08:30:00.000Z';

/** The span of `part` in `text`, at its first occurrence after `from`. */
export function spanOf(text: string, part: string, from = 0): Span {
  const start = text.indexOf(part, from);
  if (start < 0) throw new Error(`"${part}" is not in "${text}"`);
  return { start, end: start + part.length };
}

// --- Tables of forms ---------------------------------------------------------------

export const FORMS_MESTO: FormMap = {
  mesto: ['s1', 's4', 's5'],
  mesta: ['s2'],
  mestu: ['s3'],
  meste: ['s6'],
  mestom: ['s7'],
  mestá: ['p1', 'p4', 'p5'],
  miest: ['p2'],
  mestám: ['p3'],
  mestách: ['p6'],
  mestami: ['p7'],
};

export const FORMS_KINO: FormMap = {
  kino: ['s1', 's4', 's5'],
  kina: ['s2'],
  kinu: ['s3'],
  kine: ['s6'],
  kinom: ['s7'],
  kiná: ['p1', 'p4', 'p5'],
  kín: ['p2'],
  kinám: ['p3'],
  kinách: ['p6'],
  kinami: ['p7'],
};

export const FORMS_KNIHA: FormMap = {
  kniha: ['s1', 's5'],
  knihy: ['s2', 'p1', 'p4', 'p5'],
  knihe: ['s3', 's6'],
  knihu: ['s4'],
  knihou: ['s7'],
  kníh: ['p2'],
  knihám: ['p3'],
  knihách: ['p6'],
  knihami: ['p7'],
};

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

export const FORMS_BRAT: FormMap = {
  brat: ['s1', 's5'],
  brata: ['s2', 's4'],
  bratovi: ['s3', 's6'],
  bratom: ['s7', 'p3'],
  bratia: ['p1', 'p5'],
  bratov: ['p2', 'p4'],
  bratoch: ['p6'],
  bratmi: ['p7'],
};

const CASE_OF = {
  '1': 'nom',
  '2': 'gen',
  '3': 'dat',
  '4': 'acc',
  '5': 'voc',
  '6': 'loc',
  '7': 'ins',
} as const;

/**
 * Readings of the noun tags above, written out for the examples. This decodes only the
 * `s2`/`p4` shapes used here; `packages/ling` owns the real tag parser.
 */
export function nounReadings(tags: string[]) {
  return tags.map((tag) => ({
    tag,
    case: CASE_OF[tag[1] as keyof typeof CASE_OF],
    number: tag[0] === 's' ? ('sg' as const) : ('pl' as const),
  }));
}

// --- Exercises ---------------------------------------------------------------------

type ExerciseItemIn = z.input<typeof ExerciseItemSchema>;

const KUPIM_KNIHU = 'Kúpim knihu.';
export const EX_KNIHU: ExerciseItemIn = {
  exerciseId: 'ex-3fa94c21d0',
  kind: 'cloze',
  sentenceSk: KUPIM_KNIHU,
  sentenceEn: 'I will buy a book.',
  blank: spanOf(KUPIM_KNIHU, 'knihu'),
  cue: 'kniha',
  answers: ['knihu'],
  features: { case: 'acc', number: 'sg', gender: 'f', pattern: 'zena' },
  formMap: FORMS_KNIHA,
  siblingEndings: { ulica: 'u', dlan: '', kost: '', gazdina: 'ú' },
};

const VIDIM_ZENU = 'Vidím ženu.';
export const EX_ZENU: ExerciseItemIn = {
  exerciseId: 'ex-5c2e81b7a4',
  kind: 'choice_form',
  sentenceSk: VIDIM_ZENU,
  sentenceEn: 'I see a woman.',
  blank: spanOf(VIDIM_ZENU, 'ženu'),
  cue: 'žena',
  answers: ['ženu'],
  options: [
    { text: 'ženu', correct: true },
    { text: 'žena', correct: false },
    { text: 'žene', correct: false },
  ],
  features: { case: 'acc', number: 'sg', gender: 'f', pattern: 'zena' },
  formMap: FORMS_ZENA,
};

const SOM_V_KINE = 'Dnes som v kine.';
export const EX_KINE: ExerciseItemIn = {
  exerciseId: 'ex-9d04b3e2f1',
  kind: 'choice_form',
  sentenceSk: SOM_V_KINE,
  sentenceEn: 'Today I am at the cinema.',
  blank: spanOf(SOM_V_KINE, 'kine'),
  cue: 'kino',
  answers: ['kine'],
  options: [
    { text: 'kine', correct: true },
    { text: 'kino', correct: false },
    { text: 'kina', correct: false },
  ],
  features: { case: 'loc', number: 'sg', gender: 'n', pattern: 'mesto' },
  trigger: { id: 'prep-v-loc', kind: 'preposition', label: 'v + locative' },
  formMap: FORMS_KINO,
};

export const IDEM_DO_MESTA = 'Idem do mesta.';
export const EX_MESTA: ExerciseItemIn = {
  exerciseId: 'ex-7b21c0d4e9',
  kind: 'cloze',
  sentenceSk: IDEM_DO_MESTA,
  sentenceEn: 'I am going to town.',
  blank: spanOf(IDEM_DO_MESTA, 'mesta'),
  cue: 'mesto',
  answers: ['mesta'],
  features: { case: 'gen', number: 'sg', gender: 'n', pattern: 'mesto' },
  trigger: { id: 'prep-do', kind: 'preposition', label: 'do + genitive' },
  formMap: FORMS_MESTO,
  siblingEndings: { srdce: 'a', vysvedcenie: 'ia', dievca: 'aťa' },
};

const POMAHAM_BRATOVI = 'Pomáham bratovi.';
export const EX_BRATOVI: ExerciseItemIn = {
  exerciseId: 'ex-b4e1f09a37',
  kind: 'cloze',
  sentenceSk: POMAHAM_BRATOVI,
  sentenceEn: 'I help my brother.',
  blank: spanOf(POMAHAM_BRATOVI, 'bratovi'),
  cue: 'brat',
  answers: ['bratovi'],
  features: { case: 'dat', number: 'sg', gender: 'm_anim', pattern: 'chlap' },
  trigger: { id: 'verb-pomahat', kind: 'verb', label: 'pomáhať + dative' },
  formMap: FORMS_BRAT,
  siblingEndings: { hrdina: 'ovi', dub: 'u', stroj: 'u', kuli: 'mu' },
};

// --- Cards and notes -------------------------------------------------------------------

type CardSnapshotIn = z.input<typeof CardSnapshotSchema>;

/** Opaque scheduler state, as packages/srs might store it. */
const SCHEDULER = {
  v: 'ts-fsrs@6/fsrs-7',
  due: TOMORROW,
  stability: 4.93,
  difficulty: 5.1,
  reps: 4,
  lapses: 0,
  state: 2,
  lastReview: NOW,
};

export const CARD_MESTO: CardSnapshotIn = {
  cardId: IDS.cardMesto,
  state: 'review',
  dueAt: TOMORROW,
  stability: 4.93,
  difficulty: 5.1,
  reps: 4,
  lapses: 0,
  scheduler: SCHEDULER,
};

const BYVAM_V_MESTE = 'Bývam v meste.';

export const NOTE_MESTO_DETAIL: z.input<typeof NoteDetailSchema> = {
  note: {
    id: IDS.noteMesto,
    kind: 'word',
    lemmaId: 20,
    exerciseId: null,
    textId: IDS.text,
    content: {
      kind: 'word',
      lemmaId: 20,
      lemma: 'mesto',
      glossEn: 'town, city',
      variants: [
        {
          sentenceId: 'tat-8214994',
          sentenceSk: IDEM_DO_MESTA,
          sentenceEn: 'I am going to town.',
          blank: spanOf(IDEM_DO_MESTA, 'mesta'),
          answer: 'mesta',
          tag: 's2',
        },
        {
          sentenceSk: BYVAM_V_MESTE,
          sentenceEn: 'I live in a town.',
          blank: spanOf(BYVAM_V_MESTE, 'meste'),
          answer: 'meste',
          tag: 's6',
        },
      ],
    },
    source: 'reader',
    sourceRef: { sentence: 0 },
    suspended: false,
    createdAt: CREATED,
    updatedAt: NOW,
  },
  card: {
    ...CARD_MESTO,
    noteId: IDS.noteMesto,
    suspended: false,
    lastReviewAt: NOW,
  },
  reviews: [
    {
      id: IDS.review1,
      answeredAt: NOW,
      rating: 3,
      grade: 'correct',
      overridden: false,
      typed: 'mesta',
      expected: 'mesta',
      variant: 0,
      durationMs: 4200,
    },
  ],
};

export { BYVAM_V_MESTE };

// --- Profile -----------------------------------------------------------------------------

export const PROFILE: z.input<typeof ProfileSchema> = {
  userId: IDS.user,
  displayName: 'Learner',
  uiLang: 'en',
  explainLang: 'en',
  level: 'A2',
  timezone: 'Europe/Bratislava',
  dayStartHour: 4,
  dailyNewLimit: 10,
  dailyReviewLimit: 80,
  desiredRetention: 0.9,
  strictDiacritics: false,
  wordsBandTarget: 1000,
  settings: {},
  placementDoneAt: CREATED,
  currentLessonId: 'loc-sg',
  createdAt: CREATED,
  updatedAt: NOW,
};

// --- Reader ------------------------------------------------------------------------------

export const TEXT_BODY = 'Bývam v Bratislave. Dnes idem do kina.';
const S2 = TEXT_BODY.indexOf('Dnes');

function tok(word: string, from = 0) {
  const { start, end } = spanOf(TEXT_BODY, word, from);
  return { s: start, e: end };
}

export const TEXT_ANALYSIS: z.input<typeof TextAnalysisSchema> = {
  v: 1,
  sentences: [
    {
      s: 0,
      e: S2 - 1,
      tokens: [
        { ...tok('Bývam'), t: 'word', l: 64, tag: 'v:Kesa+', m: 'single' },
        { ...tok('v'), t: 'word', l: 50, m: 'single' },
        {
          ...tok('Bratislave'),
          t: 'word',
          l: 31,
          tag: 's6',
          m: 'rule',
          trig: { i: 1, kind: 'preposition', id: 'prep-v-loc' },
        },
        { ...tok('.'), t: 'punct' },
      ],
    },
    {
      s: S2,
      e: TEXT_BODY.length,
      en: 'Today I am going to the cinema.',
      tokens: [
        { ...tok('Dnes'), t: 'word', l: 71, m: 'single' },
        { ...tok('idem'), t: 'word', l: 62, tag: 'v:Kesa+', m: 'single' },
        { ...tok('do', S2), t: 'word', l: 45, m: 'single' },
        {
          ...tok('kina'),
          t: 'word',
          l: 21,
          tag: 's2',
          m: 'single',
          trig: { i: 2, kind: 'preposition', id: 'prep-do' },
        },
        { ...tok('.', S2), t: 'punct' },
      ],
    },
  ],
  lemmas: {
    '64': { lemma: 'bývať', pos: 'verb', gloss: ['to live'] },
    '50': { lemma: 'v', pos: 'prep', gloss: ['in'] },
    '31': { lemma: 'Bratislava', pos: 'noun', gender: 'f', gloss: ['Bratislava'] },
    '71': { lemma: 'dnes', pos: 'adv', gloss: ['today'] },
    '62': { lemma: 'ísť', pos: 'verb', gloss: ['to go'] },
    '45': { lemma: 'do', pos: 'prep', gloss: ['to, into'] },
    '21': { lemma: 'kino', pos: 'noun', gender: 'n', gloss: ['cinema'] },
  },
};

// --- Tutor -------------------------------------------------------------------------------

export const LEARNER_MESSAGE = 'Dnes idem do kina s kamarát.';
export const TUTOR_OPENING = 'Ideš dnes do mesta?';
export const TUTOR_REPLY = 'S kým ideš do kina?';

const KAMARAT = spanOf(LEARNER_MESSAGE, 'kamarát');

type TutorErrorIn = z.input<typeof TutorErrorSchema>;

/** The error while it is prompted: no expected form. */
export const TUTOR_ERROR_PROMPTED: TutorErrorIn = {
  id: IDS.tutorError,
  messageId: IDS.learnerMessage1,
  start: KAMARAT.start,
  end: KAMARAT.end,
  given: 'kamarát',
  errorType: 'case_after_preposition',
  caseGiven: 'nom',
  lemmaId: 2,
  triggerId: 'prep-s-ins',
  severity: 'case',
  verified: true,
  status: 'prompted',
  noteId: null,
};

/** The same error once corrected: the expected form arrives. */
export const TUTOR_ERROR_CORRECTED: TutorErrorIn = {
  ...TUTOR_ERROR_PROMPTED,
  expected: 'kamarátom',
  correctedSentence: 'Dnes idem do kina s kamarátom.',
  caseExpected: 'ins',
  explanationEn: 'After s meaning "with", use the instrumental: s kamarátom.',
  status: 'corrected',
  noteId: IDS.noteCase,
};
