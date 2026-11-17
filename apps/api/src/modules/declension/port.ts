// AttemptsPort of the declension module. Owner: B5, who replaces the body of this factory
// with the real port. container.ts calls it.
import type { AttemptsPort, PortContext } from '../../ports';
import { createAttemptsRecorder } from '../../testing/recorders';

export function createAttemptsPort(_ctx: PortContext): AttemptsPort {
  return createAttemptsRecorder();
}
