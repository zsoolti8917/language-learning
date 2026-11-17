// HTTP handlers of the reports module. Owner: B7.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('reports.create', async ({ userId, body, withUser, deps, c }) => {
    const out = await withUser((tx) => service.createReport(tx, userId, body, deps.clock.now()));
    // A repeat returns the stored report with 200 (API conventions); a new one gets 201.
    if (!out.created) return c.json({ id: out.id }, 200);
    return { id: out.id };
  }),
];
