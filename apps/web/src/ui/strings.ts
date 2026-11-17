/**
 * Default English text of the design system. Every component that shows text of
 * its own takes it as a prop, so the app can pass strings from its messages file;
 * these defaults apply when it does not.
 */
export const UI_STRINGS = {
  caseNames: {
    nom: 'Nominative',
    gen: 'Genitive',
    dat: 'Dative',
    acc: 'Accusative',
    voc: 'Vocative',
    loc: 'Locative',
    ins: 'Instrumental',
  },
  caseShort: {
    nom: 'Nom',
    gen: 'Gen',
    dat: 'Dat',
    acc: 'Acc',
    voc: 'Voc',
    loc: 'Loc',
    ins: 'Ins',
  },
  answerStates: {
    idle: '',
    correct: 'Correct',
    close: 'Almost',
    wrong: 'Wrong',
  },
  tokenStatus: {
    unknown: 'new word',
    learning: 'learning',
    known: 'known',
    ignored: 'ignored',
  },
  accentBar: 'Slovak letters',
  charCount: '{count} characters',
  charCountMax: '{count} of {max} characters',
  close: 'Close',
  loading: 'Loading',
  notifications: 'Notifications',
} as const;
