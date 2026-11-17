// Logic of the reports module. Owner: B7. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample } from '../../platform/stub';

export function reportsCreate(): ResponseOf<'reports.create'> {
  return contractExample('reports.create');
}
