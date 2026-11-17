// Logic of the review module. Owner: B1. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample } from '../../platform/stub';

export function reviewQueue(): ResponseOf<'review.queue'> {
  return contractExample('review.queue');
}

export function reviewSubmitAnswers(): ResponseOf<'review.submitAnswers'> {
  return contractExample('review.submitAnswers');
}
