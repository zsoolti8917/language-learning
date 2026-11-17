// HTTP handlers of the placement module. Owner: B6.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('placement.start', ({ body, userId, withUser, ports, deps }) =>
    withUser((tx) =>
      service.start(tx, { ports, clock: deps.clock, ids: deps.ids }, userId, body.id),
    ),
  ),
  route('placement.answer', ({ params, body, userId, withUser, ports, deps }) =>
    withUser((tx) =>
      service.answer(tx, { ports, clock: deps.clock, ids: deps.ids }, userId, params.id, body),
    ),
  ),
  route('placement.get', ({ params, withUser }) => withUser((tx) => service.get(tx, params.id))),
];
