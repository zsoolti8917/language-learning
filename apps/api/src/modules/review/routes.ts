// HTTP handlers of the review module. Owner: B1.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('review.queue', ({ query, userId, withUser, deps, ports }) =>
    withUser((tx) => service.reviewQueue(tx, { clock: deps.clock, ports }, userId, query.limit)),
  ),
  route('review.submitAnswers', ({ body, userId, withUser, deps, ports }) =>
    withUser((tx) => service.submitAnswers(tx, { clock: deps.clock, ports }, userId, body)),
  ),
];
