// Logic of the system module. Owner: F5.
import type { Health } from '@app/contracts';
import type { AppDeps } from '../../platform/deps';
import * as repo from './repo';

export async function health(deps: Pick<AppDeps, 'config' | 'database'>): Promise<Health> {
  return {
    ok: true,
    version: deps.config.version,
    contentVersion: await repo.contentVersion(deps.database),
  };
}
