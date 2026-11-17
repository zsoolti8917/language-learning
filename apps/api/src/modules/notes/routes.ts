// HTTP handlers of the notes module. Owner: B1.
// F5 stand in: every handler answers with the contract example until B1 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('notes.list', () => service.notesList()),
  route('notes.get', () => service.notesGet()),
  route('notes.create', () => service.notesCreate()),
  route('notes.update', () => service.notesUpdate()),
  route('notes.delete', () => service.notesDelete()),
];
