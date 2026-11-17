// Logic of the tutor module. Owner: B9. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample, exampleTutorStream } from '../../platform/stub';

export function tutorScenarios(): ResponseOf<'tutor.scenarios'> {
  return contractExample('tutor.scenarios');
}

export function tutorStartConversation(): ResponseOf<'tutor.startConversation'> {
  return contractExample('tutor.startConversation');
}

export function tutorListConversations(): ResponseOf<'tutor.listConversations'> {
  return contractExample('tutor.listConversations');
}

export function tutorGetConversation(): ResponseOf<'tutor.getConversation'> {
  return contractExample('tutor.getConversation');
}

export function tutorSendMessage(): Response {
  return exampleTutorStream();
}

export function tutorPeek(): ResponseOf<'tutor.peek'> {
  return contractExample('tutor.peek');
}

export function tutorEnd(): ResponseOf<'tutor.end'> {
  return contractExample('tutor.end');
}

export function tutorDisputeError(): ResponseOf<'tutor.disputeError'> {
  return contractExample('tutor.disputeError');
}
