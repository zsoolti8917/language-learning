// Logic of the placement module. Owner: B6. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample } from '../../platform/stub';

export function placementStart(): ResponseOf<'placement.start'> {
  return contractExample('placement.start');
}

export function placementAnswer(): ResponseOf<'placement.answer'> {
  return contractExample('placement.answer');
}

export function placementGet(): ResponseOf<'placement.get'> {
  return contractExample('placement.get');
}
