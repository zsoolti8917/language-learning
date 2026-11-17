// At least one example request and response per endpoint. The client's mock server replays
// them and tests parse them, so mocks, tests and the mini dataset agree.
import type { z } from 'zod';
import type { ErrorResponse } from '../common';
import type { EndpointName, Endpoints, RequestInput } from '../endpoints';
import type { TutorStreamEvent } from '../entities';
import {
  BYVAM_V_MESTE,
  CARD_MESTO,
  CREATED,
  EARLIER,
  EX_BRATOVI,
  EX_KINE,
  EX_KNIHU,
  EX_MESTA,
  EX_ZENU,
  FORMS_KNIHA,
  FORMS_MESTO,
  IDEM_DO_MESTA,
  IDS,
  LEARNER_MESSAGE,
  NOTE_MESTO_DETAIL,
  NOW,
  nounReadings,
  PROFILE,
  SCHEDULER_CASE_CARD,
  spanOf,
  TEXT_ANALYSIS,
  TEXT_BODY,
  TOMORROW,
  TUTOR_ERROR_CORRECTED,
  TUTOR_ERROR_PROMPTED,
  TUTOR_OPENING,
  TUTOR_REPLY,
} from './data';
import { TUTOR_STREAM_BUDGET_ERROR, TUTOR_STREAM_EXAMPLE } from './tutor-stream';

type ResponseIn<N extends EndpointName> = Endpoints[N]['response'] extends z.ZodType
  ? z.input<Endpoints[N]['response']>
  : never;

/** Leaves out the parts an endpoint does not take. */
type RequestExample<N extends EndpointName> = {
  [K in keyof RequestInput<N> as [RequestInput<N>[K]] extends [never]
    ? never
    : K]?: RequestInput<N>[K];
};

export type SuccessExample<N extends EndpointName> = {
  title?: string;
  request: RequestExample<N>;
  response: { status: Endpoints[N]['status']; body?: ResponseIn<N> };
  /** Only for the streaming endpoint: the events in order. */
  stream?: TutorStreamEvent[];
};

export type ErrorExample<N extends EndpointName> = {
  title?: string;
  request: RequestExample<N>;
  response: { status: number; body: ErrorResponse };
};

export type EndpointExamples<N extends EndpointName> = {
  /** At least one success example; the first is the one mocks return by default. */
  ok: [SuccessExample<N>, ...SuccessExample<N>[]];
  errors?: ErrorExample<N>[];
};

export type ExampleTable = { [N in EndpointName]: EndpointExamples<N> };

const KUPIM = 'Kúpim ___.';

export const examples: ExampleTable = {
  // --- System and profile ---------------------------------------------------------------
  'system.health': {
    ok: [
      {
        request: {},
        response: {
          status: 200,
          body: { ok: true, version: '0.1.0', contentVersion: '2026-11-17.1' },
        },
      },
    ],
  },
  'profile.get': {
    ok: [{ request: {}, response: { status: 200, body: PROFILE } }],
    errors: [
      {
        title: 'missing token',
        request: {},
        response: {
          status: 401,
          body: { error: { code: 'unauthorized', message: 'Sign in again.' } },
        },
      },
    ],
  },
  'profile.update': {
    ok: [
      {
        request: { body: { dailyNewLimit: 15, strictDiacritics: true } },
        response: {
          status: 200,
          body: { ...PROFILE, dailyNewLimit: 15, strictDiacritics: true },
        },
      },
    ],
    errors: [
      {
        title: 'value out of range',
        request: { body: { dayStartHour: 30 } },
        response: {
          status: 400,
          body: {
            error: {
              code: 'validation_failed',
              message: 'The request does not match the schema.',
              details: { fields: { 'body.dayStartHour': 'Too big: expected number to be <=23' } },
            },
          },
        },
      },
    ],
  },
  'profile.delete': { ok: [{ request: {}, response: { status: 204 } }] },
  'profile.export': {
    ok: [
      {
        request: {},
        response: {
          status: 200,
          body: {
            version: 1,
            exportedAt: NOW,
            profile: PROFILE,
            tables: {
              userLemma: [
                {
                  lemmaId: 20,
                  status: 'learning',
                  source: 'reader',
                  knownAt: null,
                  updatedAt: NOW,
                },
              ],
              note: [{ id: IDS.noteMesto, kind: 'word', lemmaId: 20, source: 'reader' }],
            },
          },
        },
      },
    ],
  },
  'profile.today': {
    ok: [
      {
        request: {},
        response: {
          status: 200,
          body: {
            date: '2026-11-17',
            review: { due: 12, new: 5, learning: 2 },
            continueText: {
              id: IDS.text,
              title: 'V Bratislave',
              coverage: 0.86,
              progress: { sentence: 1 },
            },
            nextLesson: {
              id: 'loc-sg',
              titleEn: 'Locative singular',
              titleSk: 'Lokál jednotného čísla',
              status: 'in_progress',
            },
            weakBuckets: [
              { case: 'loc', number: 'sg', gender: 'f', attempts: 9, mastery: 0.48, level: 'weak' },
            ],
            tutorSuggestion: {
              scenarioId: 'scn-coach-loc',
              mode: 'case_coach',
              titleEn: 'Where are you?',
              titleSk: 'Kde si?',
            },
            words: {
              band: 0,
              fromRank: 1,
              toRank: 1000,
              total: 1000,
              known: 212,
              learning: 40,
              target: 1000,
            },
          },
        },
      },
    ],
  },
  'profile.stats': {
    ok: [
      {
        request: {},
        response: {
          status: 200,
          body: {
            reviewsPerDay: [
              { date: '2026-11-11', reviews: 40, correct: 34 },
              { date: '2026-11-12', reviews: 52, correct: 45 },
              { date: '2026-11-13', reviews: 0, correct: 0 },
              { date: '2026-11-14', reviews: 61, correct: 50 },
              { date: '2026-11-15', reviews: 38, correct: 35 },
              { date: '2026-11-16', reviews: 44, correct: 39 },
              { date: '2026-11-17', reviews: 12, correct: 11 },
            ],
            retention30d: 0.88,
            words: { known: 212, learning: 40 },
            mastery: [
              {
                case: 'acc',
                number: 'sg',
                gender: 'f',
                attempts: 30,
                mastery: 0.91,
                level: 'strong',
              },
              {
                case: 'gen',
                number: 'sg',
                gender: 'n',
                attempts: 3,
                mastery: 0.5,
                level: 'unseen',
              },
            ],
          },
        },
      },
    ],
  },

  // --- Review ---------------------------------------------------------------------------
  'review.queue': {
    ok: [
      {
        request: { query: { limit: '50' } },
        response: {
          status: 200,
          body: {
            items: [
              {
                cardId: IDS.cardCase,
                noteId: IDS.noteCase,
                kind: 'case_sentence',
                state: 'review',
                dueAt: EARLIER,
                prompt: {
                  sentenceSk: IDEM_DO_MESTA,
                  blank: spanOf(IDEM_DO_MESTA, 'mesta'),
                  sentenceEn: 'I am going to town.',
                  cue: 'mesto',
                },
                answers: ['mesta'],
                formMap: FORMS_MESTO,
                explain: {
                  case: 'gen',
                  number: 'sg',
                  triggerLabel: 'do + genitive',
                  patternId: 'mesto',
                },
                variant: 0,
                scheduler: SCHEDULER_CASE_CARD,
              },
              {
                cardId: IDS.cardKniha,
                noteId: IDS.noteKniha,
                kind: 'word',
                state: 'new',
                dueAt: null,
                prompt: {
                  sentenceSk: 'Mám päť kníh.',
                  blank: spanOf('Mám päť kníh.', 'kníh'),
                  sentenceEn: 'I have five books.',
                  glossEn: 'book',
                },
                answers: ['kníh'],
                formMap: FORMS_KNIHA,
                explain: { case: 'gen', number: 'pl', triggerLabel: 'päť + genitive plural' },
                variant: 1,
                scheduler: null,
              },
            ],
            counts: { due: 12, new: 5, learning: 2 },
            serverTime: NOW,
          },
        },
      },
    ],
  },
  'review.submitAnswers': {
    ok: [
      {
        request: {
          body: {
            clientId: 'web-3f9a',
            answers: [
              {
                id: IDS.review1,
                cardId: IDS.cardMesto,
                answeredAt: NOW,
                typed: 'mesta',
                variant: 0,
                clientGrade: 'correct',
                rating: 3,
                overridden: false,
                durationMs: 4200,
              },
            ],
          },
        },
        response: {
          status: 200,
          body: {
            results: [
              {
                id: IDS.review1,
                cardId: IDS.cardMesto,
                grade: 'correct',
                rating: 3,
                card: CARD_MESTO,
              },
            ],
            counts: { due: 11, new: 5, learning: 2 },
          },
        },
      },
    ],
  },
  'notes.list': {
    ok: [
      {
        request: { query: { kind: 'word', limit: '2' } },
        response: {
          status: 200,
          body: {
            items: [
              {
                id: IDS.noteMesto,
                kind: 'word',
                label: 'mesto',
                glossEn: 'town, city',
                lemmaId: 20,
                source: 'reader',
                suspended: false,
                state: 'review',
                dueAt: TOMORROW,
                createdAt: CREATED,
              },
              {
                id: IDS.noteKniha,
                kind: 'word',
                label: 'kniha',
                glossEn: 'book',
                lemmaId: 12,
                source: 'words',
                suspended: false,
                state: 'new',
                dueAt: null,
                createdAt: CREATED,
              },
            ],
            nextCursor: 'eyJjIjoiMjAyNi0xMS0wMSJ9',
          },
        },
      },
    ],
  },
  'notes.get': {
    ok: [
      {
        request: { params: { id: IDS.noteMesto } },
        response: { status: 200, body: NOTE_MESTO_DETAIL },
      },
    ],
    errors: [
      {
        title: 'unknown note',
        request: { params: { id: IDS.report } },
        response: {
          status: 404,
          body: { error: { code: 'not_found', message: 'No such note.' } },
        },
      },
    ],
  },
  'notes.create': {
    ok: [
      {
        title: 'word captured in the reader',
        request: {
          body: {
            id: IDS.noteMesto,
            kind: 'word',
            source: 'reader',
            lemmaId: 20,
            textId: IDS.text,
            context: {
              sentenceSk: BYVAM_V_MESTE,
              sentenceEn: 'I live in a town.',
              blank: spanOf(BYVAM_V_MESTE, 'meste'),
              tag: 's6',
            },
          },
        },
        response: { status: 200, body: NOTE_MESTO_DETAIL },
      },
      {
        title: 'phrase captured in the reader',
        request: {
          body: {
            id: IDS.notePhrase,
            kind: 'phrase',
            source: 'reader',
            textId: IDS.text,
            content: {
              kind: 'phrase',
              textSk: 'do kina',
              glossEn: 'to the cinema',
              context: {
                sentenceSk: 'Dnes idem do kina.',
                sentenceEn: 'Today I am going to the cinema.',
                blank: spanOf('Dnes idem do kina.', 'do kina'),
              },
            },
          },
        },
        response: {
          status: 200,
          body: {
            note: {
              id: IDS.notePhrase,
              kind: 'phrase',
              lemmaId: null,
              exerciseId: null,
              textId: IDS.text,
              content: {
                kind: 'phrase',
                textSk: 'do kina',
                glossEn: 'to the cinema',
                context: {
                  sentenceSk: 'Dnes idem do kina.',
                  sentenceEn: 'Today I am going to the cinema.',
                  blank: spanOf('Dnes idem do kina.', 'do kina'),
                },
              },
              source: 'reader',
              sourceRef: null,
              suspended: false,
              createdAt: NOW,
              updatedAt: NOW,
            },
            card: {
              cardId: IDS.cardCase,
              noteId: IDS.notePhrase,
              state: 'new',
              dueAt: null,
              stability: null,
              difficulty: null,
              reps: 0,
              lapses: 0,
              scheduler: null,
              suspended: false,
              lastReviewAt: null,
            },
            reviews: [],
          },
        },
      },
    ],
  },
  'notes.update': {
    ok: [
      {
        request: { params: { id: IDS.noteMesto }, body: { suspended: true } },
        response: {
          status: 200,
          body: {
            ...NOTE_MESTO_DETAIL,
            note: { ...NOTE_MESTO_DETAIL.note, suspended: true },
          },
        },
      },
    ],
  },
  'notes.delete': {
    ok: [{ request: { params: { id: IDS.noteMesto } }, response: { status: 204 } }],
  },

  // --- Words and placement --------------------------------------------------------------
  'words.bands': {
    ok: [
      {
        request: {},
        response: {
          status: 200,
          body: {
            bands: [
              {
                band: 0,
                fromRank: 1,
                toRank: 1000,
                total: 1000,
                known: 212,
                learning: 40,
                unknown: 748,
              },
              {
                band: 1,
                fromRank: 1001,
                toRank: 2000,
                total: 1000,
                known: 60,
                learning: 12,
                unknown: 928,
              },
            ],
          },
        },
      },
    ],
  },
  'words.list': {
    ok: [
      {
        request: { query: { band: '0', status: 'unknown', limit: '50' } },
        response: {
          status: 200,
          body: {
            items: [
              {
                lemmaId: 6,
                lemma: 'dom',
                pos: 'noun',
                rank: 88,
                glossEn: 'house, home',
                status: 'unknown',
                topForms: [
                  { form: 'dom', tag: 's1', share: 0.38 },
                  { form: 'domu', tag: 's2', share: 0.27 },
                ],
              },
              {
                lemmaId: 12,
                lemma: 'kniha',
                pos: 'noun',
                rank: 240,
                glossEn: 'book',
                status: 'unknown',
                topForms: [
                  { form: 'kniha', tag: 's1', share: 0.3 },
                  { form: 'knihy', tag: 's2', share: 0.25 },
                ],
              },
            ],
            nextCursor: null,
          },
        },
      },
    ],
  },
  'words.triage': {
    ok: [
      {
        request: {
          body: {
            decisions: [
              { lemmaId: 6, decision: 'known' },
              { lemmaId: 12, decision: 'learn' },
              { lemmaId: 10, decision: 'ignored' },
            ],
          },
        },
        response: { status: 200, body: { updated: 3, notesCreated: 1 } },
      },
    ],
  },
  'lemmas.get': {
    ok: [
      {
        request: { params: { id: '20' } },
        response: {
          status: 200,
          body: {
            lemma: {
              id: 20,
              key: 'mesto|noun|n|1',
              lemma: 'mesto',
              pos: 'noun',
              gender: 'n',
              pattern: 'mesto',
              aspect: null,
              freqRank: 152,
              topForms: [
                { form: 'mesto', tag: 's1', share: 0.31 },
                { form: 'meste', tag: 's6', share: 0.22 },
                { form: 'mesta', tag: 's2', share: 0.18 },
              ],
              flags: {},
            },
            senses: [
              { ord: 0, glossEn: 'town, city', note: null, source: 'wiktionary', verified: true },
            ],
            forms: Object.entries(FORMS_MESTO).map(([form, tags]) => ({
              form,
              readings: nounReadings(tags),
            })),
            sentences: [
              {
                id: 'tat-8214994',
                textSk: IDEM_DO_MESTA,
                textEn: 'I am going to town.',
                form: 'mesta',
                tag: 's2',
                span: spanOf(IDEM_DO_MESTA, 'mesta'),
              },
            ],
            status: 'learning',
            noteId: IDS.noteMesto,
          },
        },
      },
    ],
  },
  'lemmas.setStatus': {
    ok: [
      {
        request: { params: { id: '20' }, body: { status: 'known' } },
        response: { status: 200, body: { lemmaId: 20, status: 'known' } },
      },
    ],
  },
  'placement.start': {
    ok: [
      {
        request: { body: { id: IDS.placement } },
        response: {
          status: 200,
          body: {
            id: IDS.placement,
            status: 'active',
            round: {
              round: 1,
              items: [
                {
                  itemId: 'v1-20',
                  kind: 'vocab',
                  lemmaId: 20,
                  lemma: 'mesto',
                  options: ['town, city', 'book', 'coffee', "I don't know"],
                },
                {
                  itemId: 'v1-65',
                  kind: 'vocab',
                  lemmaId: 65,
                  lemma: 'pomáhať',
                  options: ['to live', 'to help', 'to buy', "I don't know"],
                },
              ],
            },
          },
        },
      },
    ],
  },
  'placement.answer': {
    ok: [
      {
        title: 'the last vocabulary round leads to the case round',
        request: {
          params: { id: IDS.placement },
          body: {
            round: 3,
            answers: [
              { itemId: 'v3-20', choice: 0 },
              { itemId: 'v3-65', choice: 3 },
            ],
          },
        },
        response: {
          status: 200,
          body: {
            status: 'active',
            round: {
              round: 4,
              items: [
                {
                  itemId: 'c-acc-sg-1',
                  kind: 'case',
                  sentenceSk: KUPIM,
                  sentenceEn: 'I will buy a book.',
                  blank: spanOf(KUPIM, '___'),
                  cue: 'kniha',
                },
              ],
            },
          },
        },
      },
      {
        title: 'the case round ends the run',
        request: {
          params: { id: IDS.placement },
          body: { round: 4, answers: [{ itemId: 'c-acc-sg-1', typed: 'knihu' }] },
        },
        response: {
          status: 200,
          body: {
            status: 'completed',
            result: {
              knownUpToRank: 1000,
              lessonsTestedOut: ['acc-sg'],
              startLessonId: 'loc-sg',
              buckets: [
                { lessonId: 'acc-sg', correct: 2, total: 2 },
                { lessonId: 'loc-sg', correct: 1, total: 2 },
              ],
            },
          },
        },
      },
    ],
  },
  'placement.get': {
    ok: [
      {
        request: { params: { id: IDS.placement } },
        response: {
          status: 200,
          body: {
            id: IDS.placement,
            status: 'completed',
            result: {
              knownUpToRank: 1000,
              lessonsTestedOut: ['acc-sg'],
              startLessonId: 'loc-sg',
              buckets: [
                { lessonId: 'acc-sg', correct: 2, total: 2 },
                { lessonId: 'loc-sg', correct: 1, total: 2 },
              ],
            },
          },
        },
      },
    ],
  },

  // --- Reader ---------------------------------------------------------------------------
  'texts.create': {
    ok: [
      {
        request: { body: { id: IDS.text, title: 'V Bratislave', body: TEXT_BODY } },
        response: { status: 202, body: { id: IDS.text, status: 'processing' } },
      },
    ],
    errors: [
      {
        title: 'too many imports',
        request: { body: { id: IDS.text, body: TEXT_BODY } },
        response: {
          status: 429,
          body: {
            error: {
              code: 'rate_limited',
              message: 'Too many text imports.',
              details: { retryAfterSeconds: 1200 },
            },
          },
        },
      },
    ],
  },
  'texts.list': {
    ok: [
      {
        request: { query: { archived: 'false' } },
        response: {
          status: 200,
          body: {
            items: [
              {
                id: IDS.text,
                title: 'V Bratislave',
                source: 'paste',
                sourceRef: null,
                status: 'ready',
                tokenCount: 9,
                uniqueLemmaCount: 7,
                coverage: 0.86,
                progress: { sentence: 1 },
                archived: false,
                lastOpenedAt: NOW,
                createdAt: CREATED,
                updatedAt: NOW,
              },
            ],
            nextCursor: null,
          },
        },
      },
    ],
  },
  'texts.get': {
    ok: [
      {
        request: { params: { id: IDS.text } },
        response: {
          status: 200,
          body: {
            id: IDS.text,
            title: 'V Bratislave',
            source: 'paste',
            sourceRef: null,
            status: 'ready',
            tokenCount: 9,
            uniqueLemmaCount: 7,
            coverage: 0.86,
            progress: { sentence: 1 },
            archived: false,
            lastOpenedAt: NOW,
            createdAt: CREATED,
            updatedAt: NOW,
            body: TEXT_BODY,
            analysis: TEXT_ANALYSIS,
            error: null,
            lemmaStatus: {
              '64': 'known',
              '50': 'known',
              '31': 'known',
              '71': 'known',
              '62': 'known',
              '45': 'known',
              '21': 'learning',
            },
            phrases: [
              {
                noteId: IDS.notePhrase,
                textSk: 'do kina',
                glossEn: 'to the cinema',
                span: spanOf(TEXT_BODY, 'do kina'),
              },
            ],
          },
        },
      },
    ],
  },
  'texts.update': {
    ok: [
      {
        request: { params: { id: IDS.text }, body: { progress: { sentence: 1 } } },
        response: {
          status: 200,
          body: {
            id: IDS.text,
            title: 'V Bratislave',
            source: 'paste',
            sourceRef: null,
            status: 'ready',
            tokenCount: 9,
            uniqueLemmaCount: 7,
            coverage: 0.86,
            progress: { sentence: 1 },
            archived: false,
            lastOpenedAt: NOW,
            createdAt: CREATED,
            updatedAt: NOW,
          },
        },
      },
    ],
  },
  'texts.delete': { ok: [{ request: { params: { id: IDS.text } }, response: { status: 204 } }] },
  'texts.translateSentence': {
    ok: [
      {
        request: { params: { id: IDS.text, n: '1' } },
        response: { status: 200, body: { n: 1, en: 'Today I am going to the cinema.' } },
      },
    ],
  },
  'library.list': {
    ok: [
      {
        request: {},
        response: {
          status: 200,
          body: {
            items: [
              {
                id: 'lib-001',
                title: 'Môj deň',
                level: 'A2',
                tokenCount: 84,
                coverage: 0.62,
                textId: IDS.libraryText,
              },
            ],
          },
        },
      },
    ],
  },
  'library.add': {
    ok: [
      {
        request: { params: { id: 'lib-001' }, body: { id: IDS.libraryText } },
        response: { status: 200, body: { id: IDS.libraryText, status: 'ready' } },
      },
    ],
  },

  // --- Declension -----------------------------------------------------------------------
  'declension.course': {
    ok: [
      {
        request: {},
        response: {
          status: 200,
          body: {
            lessons: [
              {
                id: 'acc-sg',
                ord: 1,
                titleEn: 'Accusative singular',
                titleSk: 'Akuzatív jednotného čísla',
                case: 'acc',
                number: 'sg',
                status: 'completed',
                score: { correct: 7, total: 8 },
              },
              {
                id: 'loc-sg',
                ord: 2,
                titleEn: 'Locative singular',
                titleSk: 'Lokál jednotného čísla',
                case: 'loc',
                number: 'sg',
                status: 'in_progress',
                score: null,
              },
              {
                id: 'mixed',
                ord: 9,
                titleEn: 'All cases together',
                titleSk: 'Všetky pády',
                case: null,
                number: null,
                status: 'available',
                score: null,
              },
            ],
            mastery: [
              {
                case: 'acc',
                number: 'sg',
                gender: 'f',
                attempts: 30,
                mastery: 0.91,
                level: 'strong',
              },
              { case: 'loc', number: 'sg', gender: 'n', attempts: 8, mastery: 0.7, level: 'ok' },
            ],
          },
        },
      },
    ],
  },
  'declension.lesson': {
    ok: [
      {
        request: { params: { id: 'acc-sg' } },
        response: {
          status: 200,
          body: {
            lesson: {
              id: 'acc-sg',
              ord: 1,
              titleEn: 'Accusative singular',
              titleSk: 'Akuzatív jednotného čísla',
              case: 'acc',
              number: 'sg',
              focus: {
                buckets: [
                  { case: 'acc', number: 'sg', gender: 'f', weight: 0.4 },
                  { case: 'acc', number: 'sg', gender: 'm_anim', weight: 0.3 },
                  { case: 'acc', number: 'sg', gender: 'm_inan', weight: 0.2 },
                  { case: 'acc', number: 'sg', gender: 'n', weight: 0.1 },
                ],
                triggerIds: ['prep-pre'],
              },
              summaryMd: 'The accusative marks the direct object: *Vidím ženu.*',
              prerequisites: [],
            },
            steps: [
              {
                ord: 0,
                content: {
                  kind: 'explain',
                  md: 'Feminine nouns in *-a* take *-u*: *žena → ženu*.',
                  examples: [
                    {
                      sk: 'Vidím ženu.',
                      en: 'I see a woman.',
                      highlight: spanOf('Vidím ženu.', 'ženu'),
                    },
                  ],
                },
                exercises: [],
              },
              { ord: 1, content: { kind: 'triggers', triggerIds: ['prep-pre'] }, exercises: [] },
              {
                ord: 2,
                content: { kind: 'comprehension', exerciseIds: [EX_ZENU.exerciseId] },
                exercises: [EX_ZENU],
              },
              {
                ord: 3,
                content: { kind: 'production', exerciseIds: [EX_KNIHU.exerciseId] },
                exercises: [EX_KNIHU],
              },
              {
                ord: 4,
                content: {
                  kind: 'checkpoint',
                  exerciseIds: [EX_KNIHU.exerciseId, EX_ZENU.exerciseId],
                  passShare: 0.75,
                },
                exercises: [EX_KNIHU, EX_ZENU],
              },
            ],
            triggers: [
              {
                id: 'prep-pre',
                kind: 'preposition',
                lemma: 'pre',
                lemmaId: 56,
                case: 'acc',
                meaningEn: 'for',
                noteEn: null,
                exampleSk: 'Kúpim kávu pre brata.',
                exampleEn: 'I will buy coffee for my brother.',
                contrastGroup: null,
              },
            ],
            progress: {
              lessonId: 'acc-sg',
              status: 'in_progress',
              stepIndex: 2,
              score: null,
              startedAt: CREATED,
              completedAt: null,
              updatedAt: NOW,
            },
          },
        },
      },
    ],
  },
  'declension.saveProgress': {
    ok: [
      {
        request: {
          params: { id: 'acc-sg' },
          body: { stepIndex: 4, status: 'completed', score: { correct: 7, total: 8 } },
        },
        response: {
          status: 200,
          body: {
            lessonId: 'acc-sg',
            status: 'completed',
            stepIndex: 4,
            score: { correct: 7, total: 8 },
            startedAt: CREATED,
            completedAt: NOW,
            updatedAt: NOW,
          },
        },
      },
    ],
  },
  'declension.createSession': {
    ok: [
      {
        request: { body: { mode: 'mixed', size: 3, seed: 42 } },
        response: {
          status: 200,
          body: { sessionId: IDS.session, seed: 42, items: [EX_MESTA, EX_KINE, EX_BRATOVI] },
        },
      },
    ],
  },
  'declension.submitAttempts': {
    ok: [
      {
        request: {
          body: {
            attempts: [
              {
                id: IDS.attempt1,
                sessionId: IDS.session,
                source: 'trainer',
                exerciseId: EX_MESTA.exerciseId,
                typed: 'meste',
                correct: false,
                retry: false,
                clientDiagnosis: 'other_case',
                occurredAt: EARLIER,
                durationMs: 5100,
              },
              {
                id: IDS.attempt2,
                sessionId: IDS.session,
                source: 'trainer',
                exerciseId: EX_MESTA.exerciseId,
                typed: 'mesta',
                correct: true,
                retry: true,
                clientDiagnosis: 'correct',
                occurredAt: NOW,
                durationMs: 2300,
              },
            ],
          },
        },
        response: {
          status: 200,
          body: {
            accepted: 2,
            cardsCreated: 1,
            mastery: [
              { case: 'gen', number: 'sg', gender: 'n', attempts: 5, mastery: 0.41, level: 'weak' },
            ],
          },
        },
      },
    ],
  },
  'declension.pattern': {
    ok: [
      {
        request: { params: { id: 'mesto' } },
        response: {
          status: 200,
          body: {
            id: 'mesto',
            labelSk: 'mesto',
            pos: 'noun',
            gender: 'n',
            model: { lemmaId: 20, lemma: 'mesto' },
            everydayModel: null,
            endings: {
              s1: 'o',
              s2: 'a',
              s3: 'u',
              s4: 'o',
              s6: 'e',
              s7: 'om',
              p1: 'á',
              p2: '',
              p3: 'ám',
              p4: 'á',
              p6: 'ách',
              p7: 'ami',
            },
            notesEn: 'Hard neuter nouns. The genitive plural has no ending: mesto → miest.',
          },
        },
      },
    ],
  },

  // --- Tutor and reports ------------------------------------------------------------------
  'tutor.scenarios': {
    ok: [
      {
        request: {},
        response: {
          status: 200,
          body: {
            items: [
              {
                id: 'scn-city-walk',
                mode: 'scenario',
                titleEn: 'A walk in town',
                titleSk: 'Ideme do mesta',
                goalEn: 'Say where you are going and who you are going with.',
                level: 'A2',
                targetCases: ['gen', 'ins'],
                timesDone: 1,
              },
              {
                id: 'scn-coach-loc',
                mode: 'case_coach',
                titleEn: 'Where are you?',
                titleSk: 'Kde si?',
                goalEn: 'Answer questions about where you are.',
                level: 'A2',
                targetCases: ['loc'],
                timesDone: 0,
              },
            ],
          },
        },
      },
    ],
  },
  'tutor.startConversation': {
    ok: [
      {
        request: { body: { id: IDS.conversation, scenarioId: 'scn-city-walk' } },
        response: {
          status: 200,
          body: {
            conversation: {
              id: IDS.conversation,
              scenarioId: 'scn-city-walk',
              mode: 'scenario',
              status: 'active',
              goalState: { criteriaMet: [] },
              turnCount: 0,
              startedAt: NOW,
              endedAt: null,
              updatedAt: NOW,
            },
            scenario: scenarioBrief(),
            messages: [
              {
                id: IDS.tutorMessage0,
                seq: 0,
                role: 'tutor',
                content: TUTOR_OPENING,
                createdAt: NOW,
              },
            ],
            errors: [],
          },
        },
      },
    ],
  },
  'tutor.listConversations': {
    ok: [
      {
        request: { query: { limit: '20' } },
        response: {
          status: 200,
          body: {
            items: [
              {
                id: IDS.conversation,
                scenarioId: 'scn-city-walk',
                titleEn: 'A walk in town',
                mode: 'scenario',
                status: 'active',
                turnCount: 1,
                startedAt: NOW,
                endedAt: null,
                updatedAt: NOW,
              },
            ],
            nextCursor: null,
          },
        },
      },
    ],
  },
  'tutor.getConversation': {
    ok: [
      {
        request: { params: { id: IDS.conversation } },
        response: {
          status: 200,
          body: {
            conversation: {
              id: IDS.conversation,
              scenarioId: 'scn-city-walk',
              mode: 'scenario',
              status: 'active',
              goalState: { criteriaMet: ['c1'] },
              turnCount: 1,
              startedAt: NOW,
              endedAt: null,
              updatedAt: NOW,
            },
            scenario: scenarioBrief(),
            messages: [
              {
                id: IDS.tutorMessage0,
                seq: 0,
                role: 'tutor',
                content: TUTOR_OPENING,
                createdAt: NOW,
              },
              {
                id: IDS.learnerMessage1,
                seq: 1,
                role: 'learner',
                content: LEARNER_MESSAGE,
                createdAt: NOW,
              },
              {
                id: IDS.tutorMessage2,
                seq: 2,
                role: 'tutor',
                content: TUTOR_REPLY,
                createdAt: NOW,
              },
            ],
            errors: [TUTOR_ERROR_PROMPTED],
          },
        },
      },
    ],
  },
  'tutor.sendMessage': {
    ok: [
      {
        title: 'a case error is prompted',
        request: {
          params: { id: IDS.conversation },
          body: { clientId: IDS.learnerMessage1, content: LEARNER_MESSAGE },
        },
        response: { status: 200 },
        stream: TUTOR_STREAM_EXAMPLE,
      },
      {
        title: 'the daily budget is used up',
        request: {
          params: { id: IDS.conversation },
          body: { clientId: IDS.learnerMessage1, content: LEARNER_MESSAGE },
        },
        response: { status: 200 },
        stream: TUTOR_STREAM_BUDGET_ERROR,
      },
    ],
  },
  'tutor.peek': {
    ok: [
      {
        request: {
          params: { id: IDS.conversation },
          body: { kind: 'translate', messageId: IDS.tutorMessage2 },
        },
        response: { status: 200, body: { text: 'Who are you going to the cinema with?' } },
      },
    ],
  },
  'tutor.end': {
    ok: [
      {
        request: { params: { id: IDS.conversation } },
        response: {
          status: 200,
          body: {
            summary: {
              textEn: 'You said where you are going. Remember the instrumental after s.',
              goalMet: false,
              criteriaMet: ['c1'],
              errors: [TUTOR_ERROR_CORRECTED],
            },
            cardsCreated: 1,
          },
        },
      },
    ],
  },
  'tutor.disputeError': {
    ok: [
      {
        request: { params: { id: IDS.tutorError }, body: { comment: 'I think this was right.' } },
        response: { status: 200, body: { id: IDS.tutorError, status: 'disputed' } },
      },
    ],
  },
  'reports.create': {
    ok: [
      {
        request: {
          body: {
            id: IDS.report,
            targetKind: 'exercise',
            targetRef: EX_MESTA.exerciseId,
            comment: 'The translation sounds odd.',
          },
        },
        response: { status: 201, body: { id: IDS.report } },
      },
    ],
  },
};

function scenarioBrief() {
  return {
    id: 'scn-city-walk',
    mode: 'scenario' as const,
    titleEn: 'A walk in town',
    titleSk: 'Ideme do mesta',
    goalEn: 'Say where you are going and who you are going with.',
    settingSk: 'Si v Bratislave.',
    level: 'A2' as const,
    successCriteria: [
      { id: 'c1', textEn: 'Say where you are going.' },
      { id: 'c2', textEn: 'Say who you are going with.' },
    ],
    vocabHint: [
      { sk: 'kino', en: 'cinema' },
      { sk: 'námestie', en: 'square' },
    ],
  };
}

/** The first success example of an endpoint: what a mock returns by default. */
export function defaultExample<N extends EndpointName>(name: N): SuccessExample<N> {
  return examples[name].ok[0] as SuccessExample<N>;
}
