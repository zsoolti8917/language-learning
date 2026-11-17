// HTTP handlers of the tutor module. Owner: B9.
// F5 stand in: every handler answers with the contract example until B9 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('tutor.scenarios', () => service.tutorScenarios()),
  route('tutor.startConversation', () => service.tutorStartConversation()),
  route('tutor.listConversations', () => service.tutorListConversations()),
  route('tutor.getConversation', () => service.tutorGetConversation()),
  route('tutor.sendMessage', () => service.tutorSendMessage()),
  route('tutor.peek', () => service.tutorPeek()),
  route('tutor.end', () => service.tutorEnd()),
  route('tutor.disputeError', () => service.tutorDisputeError()),
];
