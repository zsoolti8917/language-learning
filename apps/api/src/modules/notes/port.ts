// NotesPort of the notes module. Owner: B1, who replaces the body of this factory with the
// real port. container.ts calls it.
import type { NotesPort, PortContext } from '../../ports';
import { createNotesRecorder } from '../../testing/recorders';

export function createNotesPort(ctx: PortContext): NotesPort {
  return createNotesRecorder(ctx.ids);
}
