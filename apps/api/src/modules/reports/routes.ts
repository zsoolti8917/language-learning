// HTTP handlers of the reports module. Owner: B7.
// F5 stand in: every handler answers with the contract example until B7 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [route('reports.create', () => service.reportsCreate())];
