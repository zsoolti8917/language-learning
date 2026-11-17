// HTTP handlers of the profile module. Owner: B7.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('profile.get', ({ userId, withUser }) => withUser((tx) => service.getProfile(tx, userId))),

  route('profile.update', ({ userId, body, withUser, deps }) => {
    // Checked before the transaction so a wrong time zone never opens one.
    service.checkUpdate(body);
    return withUser((tx) => service.updateProfile(tx, userId, body, deps.clock.now()));
  }),

  route('profile.delete', async ({ userId, withUser, deps }) => {
    service.checkLoginDeletion(deps.config);
    await withUser((tx) => service.deleteRows(tx, userId));
    deps.profiles.forget(userId);
    // The login goes after the rows, outside the transaction (a network call).
    await service.deleteLogin(deps.config, userId);
    return undefined;
  }),

  route('profile.export', async ({ userId, withUser, deps, c }) => {
    const now = deps.clock.now();
    const body = await withUser((tx) => service.exportAll(tx, userId, now));
    c.header(
      'Content-Disposition',
      `attachment; filename="slovak-export-${now.toISOString().slice(0, 10)}.json"`,
    );
    return body;
  }),

  route('profile.today', ({ userId, withUser, ports, deps }) =>
    withUser((tx) => service.today(tx, ports, userId, deps.clock.now())),
  ),

  route('profile.stats', ({ userId, withUser, ports, deps }) =>
    withUser((tx) => service.stats(tx, ports, userId, deps.clock.now())),
  ),
];
