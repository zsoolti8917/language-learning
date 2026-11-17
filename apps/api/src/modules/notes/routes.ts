// HTTP handlers of the notes module (the deck). Owner: B1.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('notes.list', ({ query, userId, withUser }) =>
    withUser((tx) => service.listNotes(tx, userId, query)),
  ),
  route('notes.get', ({ params, userId, withUser }) =>
    withUser((tx) => service.getNoteDetail(tx, userId, params.id)),
  ),
  route('notes.create', async ({ body, userId, withUser, deps, ports }) => {
    // A missing gloss is asked from the model before the transaction opens, never inside it.
    if (body.kind === 'word') {
      try {
        await ports.dictionary.ensureGlosses([body.lemmaId], {
          sentenceSk: body.context?.sentenceSk ?? '',
          userId,
        });
      } catch {
        // The note is still made; its gloss stays empty until the lexicon has one.
      }
    }
    return withUser((tx) => service.createNote(tx, deps, userId, body));
  }),
  route('notes.update', ({ params, body, userId, withUser, deps }) =>
    withUser((tx) => service.updateNote(tx, deps, userId, params.id, body)),
  ),
  route('notes.delete', async ({ params, userId, withUser, deps }) => {
    await withUser((tx) => service.deleteNote(tx, deps, userId, params.id));
    return undefined;
  }),
];
