// Example event sequences of `POST /tutor/conversations/:id/messages`.
import type { TutorStreamEvent } from '../entities';
import { IDS, TOMORROW, TUTOR_ERROR_PROMPTED, TUTOR_REPLY } from './data';

/** One `analysis`, many `delta`, one `done`. The prompted error carries no expected form. */
export const TUTOR_STREAM_EXAMPLE: TutorStreamEvent[] = [
  {
    event: 'analysis',
    data: {
      messageId: IDS.learnerMessage1,
      errors: [
        {
          id: TUTOR_ERROR_PROMPTED.id,
          start: TUTOR_ERROR_PROMPTED.start,
          end: TUTOR_ERROR_PROMPTED.end,
          given: TUTOR_ERROR_PROMPTED.given,
          errorType: 'case_after_preposition',
          status: 'prompted',
        },
      ],
      resolved: [],
    },
  },
  { event: 'delta', data: { text: 'S kým ' } },
  { event: 'delta', data: { text: 'ideš do kina?' } },
  {
    event: 'done',
    data: {
      tutorMessage: { id: IDS.tutorMessage2, seq: 2, content: TUTOR_REPLY },
      cardsCreated: [],
      goal: { criteriaMet: ['c1'] },
      budget: { remainingUsd: 0.71 },
    },
  },
];

/** An `error` event replaces the rest and ends the stream. */
export const TUTOR_STREAM_BUDGET_ERROR: TutorStreamEvent[] = [
  {
    event: 'error',
    data: {
      code: 'budget_exceeded',
      message: 'The daily model budget is used up.',
      details: { resetsAt: TOMORROW },
    },
  },
];
