// HTTP handlers of the words module. Owner: B6.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('words.bands', ({ withUser }) => withUser((tx) => service.bands(tx))),
  route('words.list', ({ query, withUser }) => withUser((tx) => service.list(tx, query))),
  route('words.triage', ({ body, withUser, ports }) =>
    withUser((tx) => service.triage(tx, ports, body)),
  ),
  route('lemmas.get', ({ params, withUser, ports }) =>
    withUser((tx) => service.lemmaDetail(tx, ports, params.id)),
  ),
  route('lemmas.setStatus', ({ params, body, withUser, ports }) =>
    withUser((tx) => service.setStatus(tx, ports, params.id, body.status)),
  ),
];
