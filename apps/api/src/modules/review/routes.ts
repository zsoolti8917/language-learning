// HTTP handlers of the review module. Owner: B1.
// F5 stand in: every handler answers with the contract example until B1 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('review.queue', () => service.reviewQueue()),
  route('review.submitAnswers', () => service.reviewSubmitAnswers()),
];
