// Everything a handler can reach: the container's output. `container.ts` builds it.
import type { UsageFunctions } from '@app/ai';
import type { PortContext } from '../ports';
import type { TokenVerifier } from './auth';
import type { ProfileGuard } from './profile';

export interface AppDeps extends PortContext {
  auth: TokenVerifier;
  profiles: ProfileGuard;
  usage: UsageFunctions;
}
