// NotesPort of the notes module. Owner: B1. container.ts calls the factory. Every method
// runs inside the caller's `withUser` transaction and reads the learner from it.
import { currentUserId } from '../../platform/tx';
import type { NotesPort, PortContext } from '../../ports';
import * as repo from './repo';
import * as service from './service';

export function createNotesPort(ctx: PortContext): NotesPort {
  const env: service.NotesEnv = { clock: ctx.clock, ids: ctx.ids };
  return {
    async createWordNote(tx, input) {
      return service.createWordNote(tx, env, await currentUserId(tx), input);
    },
    async createPhraseNote(tx, input) {
      return service.createPhraseNote(tx, env, await currentUserId(tx), input);
    },
    async createCaseSentenceNote(tx, input) {
      return service.createCaseSentenceNote(tx, env, await currentUserId(tx), input);
    },
    async suspendNote(tx, noteId) {
      await service.suspendNote(tx, env, await currentUserId(tx), noteId);
    },
    async setLemmaStatus(tx, lemmaIds, status, source) {
      if (lemmaIds.length === 0) return;
      await repo.upsertLemmaStatus(
        tx,
        await currentUserId(tx),
        lemmaIds,
        status,
        source,
        ctx.clock.now(),
      );
    },
  };
}
