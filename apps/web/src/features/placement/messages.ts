// Interface text of the placement check (M5).
import { defineMessages } from '../../messages';

export const m = defineMessages({
  intro: {
    lead: 'A short check finds where you start, so you skip what you already know.',
    vocab: 'Three rounds of common words: pick the meaning, or say you do not know it.',
    cases: 'One round of sentences: type the missing form of a word.',
    noFeedback:
      'You will not see right or wrong answers until the end. Guessing is fine, but “I don’t know” is better than a wild guess.',
    time: 'It takes about five minutes.',
    start: 'Start the check',
    resume: 'Continue the check',
  },
  progress: {
    label: 'Progress of the placement check',
    value: 'Round {round} of {rounds}, question {item} of {items}',
    round: 'Round {round} of {rounds}',
    item: '{item} of {items}',
    vocab: 'Words',
    cases: 'Cases',
  },
  vocab: {
    prompt: 'What does this word mean?',
    options: 'Meanings of {lemma}',
  },
  cases: {
    prompt: 'Type the missing form',
    cue: 'Use the word:',
    gap: 'missing word',
    answerLabel: 'Your answer',
    next: 'Next',
    dontKnow: 'I don’t know',
  },
  submit: {
    sending: 'Saving your answers',
    error: 'Your answers could not be sent',
    offline: 'You are offline. Your answers are kept; send them when you are back online.',
    retry: 'Send again',
  },
  result: {
    title: 'Your starting point',
    known: '{count} of the most common words count as known.',
    knownNone: 'No words count as known yet. You start with the most common ones.',
    knownHint: 'They are marked known in the word list, so they will not come up in review.',
    skipped: 'Lessons you can skip',
    skippedNone: 'No lessons skipped. The course starts from the beginning of its topic.',
    start: 'The course starts with',
    continue: 'Go to Today',
  },
  common: {
    loading: 'Loading',
    error: 'Could not load the placement check',
    retry: 'Try again',
    startError: 'The check could not start',
    offline: 'You are offline. The placement check needs a connection.',
  },
});
