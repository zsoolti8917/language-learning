// HTTP handlers of the profile module. Owner: B7.
// F5 stand in: every handler answers with the contract example until B7 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('profile.get', () => service.profileGet()),
  route('profile.update', () => service.profileUpdate()),
  route('profile.delete', () => service.profileDelete()),
  route('profile.export', () => service.profileExport()),
  route('profile.today', () => service.profileToday()),
  route('profile.stats', () => service.profileStats()),
];
