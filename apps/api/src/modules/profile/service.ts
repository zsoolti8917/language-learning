// Logic of the profile module. Owner: B7. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample } from '../../platform/stub';

export function profileGet(): ResponseOf<'profile.get'> {
  return contractExample('profile.get');
}

export function profileUpdate(): ResponseOf<'profile.update'> {
  return contractExample('profile.update');
}

export async function profileDelete(): Promise<undefined> {
  return undefined;
}

export function profileExport(): ResponseOf<'profile.export'> {
  return contractExample('profile.export');
}

export function profileToday(): ResponseOf<'profile.today'> {
  return contractExample('profile.today');
}

export function profileStats(): ResponseOf<'profile.stats'> {
  return contractExample('profile.stats');
}
