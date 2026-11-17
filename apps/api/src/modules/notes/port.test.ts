// The real NotesPort passes the shared suite of its port.
import { runNotesSuite } from '../../testing/suites/notes';
import { createNotesPort } from './port';

runNotesSuite('real', (ctx) => createNotesPort(ctx));
