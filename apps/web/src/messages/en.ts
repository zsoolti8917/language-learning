// The English messages file: every interface text of the shell. Features keep their own
// texts in features/<feature>/messages.ts through `defineMessages` (see ./index.ts), so six
// packages can add text without editing one shared file.
export const en = {
  app: {
    name: 'Slovak',
    loading: 'Loading…',
    notFound: 'This page does not exist.',
    backHome: 'Back to Today',
    error: 'Something went wrong.',
    retry: 'Try again',
    notifications: 'Notifications',
    close: 'Close',
  },
  tabs: {
    label: 'Main',
    today: 'Today',
    review: 'Review',
    read: 'Read',
    cases: 'Cases',
    tutor: 'Tutor',
  },
  placeholder: {
    note: 'This screen is coming soon.',
    param: '{name}: {value}',
  },
  screens: {
    today: 'Today',
    settings: 'Settings',
    about: 'About',
    review: 'Review',
    deck: 'Deck',
    note: 'Note',
    words: 'Common words',
    band: 'Word band',
    lemma: 'Word',
    library: 'Library',
    import: 'Import a text',
    reader: 'Reader',
    course: 'Case course',
    lesson: 'Lesson',
    trainer: 'Trainer',
    pattern: 'Pattern',
    scenarios: 'Tutor',
    chat: 'Conversation',
    login: 'Sign in',
    signup: 'Create account',
    verify: 'Enter the code',
    reset: 'Reset password',
    onboarding: 'Welcome',
    placement: 'Placement check',
  },
  dev: {
    signIn: 'Continue as the dev user',
  },
} as const;

export type Messages = typeof en;
