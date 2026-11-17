// Generated from packages/testkit/mini (the F9 mini dataset): every word, gloss, form and
// sentence here is copied from the dataset, never written by hand. Mock data only.

export interface MiniCaseItem {
  itemId: string;
  lessonId: string;
  sentenceSk: string;
  sentenceEn: string;
  blank: { start: number; end: number };
  cue: string;
  answers: string[];
}

/** One typed gap per teaching lesson, taken from the dataset's cloze exercises. */
export const MINI_CASE_ITEMS: MiniCaseItem[] = [
  {
    itemId: 'c-acc-sg',
    lessonId: 'acc-sg',
    sentenceSk: 'Vidím ___.',
    sentenceEn: 'I see a man.',
    blank: {
      start: 6,
      end: 9,
    },
    cue: 'chlap',
    answers: ['chlapa'],
  },
  {
    itemId: 'c-loc-sg',
    lessonId: 'loc-sg',
    sentenceSk: 'Píšem o ___.',
    sentenceEn: 'I am writing about a hero.',
    blank: {
      start: 8,
      end: 11,
    },
    cue: 'hrdina',
    answers: ['hrdinovi'],
  },
  {
    itemId: 'c-gen-sg',
    lessonId: 'gen-sg',
    sentenceSk: 'Idem do ___.',
    sentenceEn: 'I am going to town.',
    blank: {
      start: 8,
      end: 11,
    },
    cue: 'mesto',
    answers: ['mesta'],
  },
  {
    itemId: 'c-ins-sg',
    lessonId: 'ins-sg',
    sentenceSk: 'Idem do kina s ___.',
    sentenceEn: 'I am going to the cinema with a friend.',
    blank: {
      start: 15,
      end: 18,
    },
    cue: 'kamarát',
    answers: ['kamarátom'],
  },
  {
    itemId: 'c-dat-pron',
    lessonId: 'dat-pron',
    sentenceSk: 'Pomáham ___.',
    sentenceEn: 'I help my brother.',
    blank: {
      start: 8,
      end: 11,
    },
    cue: 'brat',
    answers: ['bratovi'],
  },
  {
    itemId: 'c-nom-acc-pl',
    lessonId: 'nom-acc-pl',
    sentenceSk: 'Mám dve ___.',
    sentenceEn: 'I have two books.',
    blank: {
      start: 8,
      end: 11,
    },
    cue: 'kniha',
    answers: ['knihy'],
  },
  {
    itemId: 'c-loc-ins-dat-pl',
    lessonId: 'loc-ins-dat-pl',
    sentenceSk: 'Hovoríme o ___.',
    sentenceEn: 'We are talking about people.',
    blank: {
      start: 11,
      end: 14,
    },
    cue: 'ľudia',
    answers: ['ľuďoch'],
  },
  {
    itemId: 'c-gen-pl',
    lessonId: 'gen-pl',
    sentenceSk: 'Mám päť ___.',
    sentenceEn: 'I have five books.',
    blank: {
      start: 8,
      end: 11,
    },
    cue: 'kniha',
    answers: ['kníh'],
  },
];
