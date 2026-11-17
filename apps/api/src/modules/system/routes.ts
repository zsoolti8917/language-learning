// HTTP handlers of the system module. Owner: F5.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [route('system.health', ({ deps }) => service.health(deps))];
