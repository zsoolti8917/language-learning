// Logic of the words module. Owner: B6. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample } from '../../platform/stub';

export function wordsBands(): ResponseOf<'words.bands'> {
  return contractExample('words.bands');
}

export function wordsList(): ResponseOf<'words.list'> {
  return contractExample('words.list');
}

export function wordsTriage(): ResponseOf<'words.triage'> {
  return contractExample('words.triage');
}

export function lemmasGet(): ResponseOf<'lemmas.get'> {
  return contractExample('lemmas.get');
}

export function lemmasSetStatus(): ResponseOf<'lemmas.setStatus'> {
  return contractExample('lemmas.setStatus');
}
