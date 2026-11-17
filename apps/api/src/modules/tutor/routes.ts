// HTTP handlers of the tutor module. Owner: B9.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('tutor.scenarios', ({ withUser }) => withUser((tx) => service.listScenarios(tx))),
  route('tutor.startConversation', ({ body, withUser, userId, deps }) =>
    withUser((tx) => service.startConversation(tx, { userId, deps }, body)),
  ),
  route('tutor.listConversations', ({ query, withUser }) =>
    withUser((tx) => service.listConversations(tx, query)),
  ),
  route('tutor.getConversation', ({ params, withUser }) =>
    withUser((tx) => service.getConversation(tx, params.id)),
  ),
  route('tutor.sendMessage', ({ params, body, withUser, userId, deps, signal }) =>
    service.sendMessage({ userId, deps, withUser }, params.id, body, signal),
  ),
  route('tutor.peek', ({ params, body, withUser, userId, deps }) =>
    service.peek({ userId, deps, withUser }, params.id, body),
  ),
  route('tutor.end', ({ params, withUser, userId, deps }) =>
    service.endConversation({ userId, deps, withUser }, params.id),
  ),
  route('tutor.disputeError', ({ params, body, withUser, userId, deps }) =>
    withUser((tx) => service.disputeError(tx, { userId, deps }, params.id, body)),
  ),
];
