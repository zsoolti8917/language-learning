// HTTP handlers of the placement module. Owner: B6.
// F5 stand in: every handler answers with the contract example until B6 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('placement.start', () => service.placementStart()),
  route('placement.answer', () => service.placementAnswer()),
  route('placement.get', () => service.placementGet()),
];
