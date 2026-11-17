// Test double of NotesPort that also writes the rows B1's real port writes: `user_lemma` for
// statuses and a bare `note` row for a word note. The F5 recorder keeps calls in memory only,
// so counts and statuses read back from the database would not change without this.
// It records every call (and the transaction it ran in) through the F5 recorder.
import { note, type Tx, userLemma } from '@app/db';
import { uuidv7 } from '@app/testkit';
import { sql } from 'drizzle-orm';
import { currentUserId } from '../../../platform/tx';
import type { NotesPort } from '../../../ports';
import { createNotesRecorder, type NotesRecorder } from '../../../testing/recorders';

export interface DbNotes extends NotesRecorder {
  /** Every transaction a method was called with, in call order. */
  readonly txs: Tx[];
  /** Makes the next calls throw after `n` more successful calls (null: never). */
  failAfter(n: number | null): void;
}

export function createDbNotes(): DbNotes {
  const rec = createNotesRecorder({ uuid: uuidv7 });
  const txs: Tx[] = [];
  let left: number | null = null;
  const step = (tx: Tx) => {
    txs.push(tx);
    if (left !== null) {
      if (left <= 0) throw new Error('db-notes: failing on purpose');
      left -= 1;
    }
  };
  const port: NotesPort = {
    async createWordNote(tx, input) {
      step(tx);
      const r = await rec.createWordNote(tx, input);
      if (r.created) {
        const userId = await currentUserId(tx);
        await tx.insert(note).values({
          id: r.noteId,
          userId,
          kind: 'word',
          lemmaId: input.lemmaId,
          content: {
            kind: 'word',
            lemmaId: input.lemmaId,
            lemma: String(input.lemmaId),
            glossEn: '-',
            variants: [],
          },
          source: input.source,
        });
      }
      return r;
    },
    createPhraseNote(tx, input) {
      step(tx);
      return rec.createPhraseNote(tx, input);
    },
    createCaseSentenceNote(tx, input) {
      step(tx);
      return rec.createCaseSentenceNote(tx, input);
    },
    suspendNote(tx, id) {
      step(tx);
      return rec.suspendNote(tx, id);
    },
    async setLemmaStatus(tx, lemmaIds, status, source) {
      step(tx);
      await rec.setLemmaStatus(tx, lemmaIds, status, source);
      if (lemmaIds.length === 0) return;
      const userId = await currentUserId(tx);
      await tx
        .insert(userLemma)
        .values(lemmaIds.map((lemmaId) => ({ userId, lemmaId, status, source })))
        .onConflictDoUpdate({
          target: [userLemma.userId, userLemma.lemmaId],
          set: { status, source, updatedAt: sql`now()` },
        });
    },
  };
  // A new object: the recorder's own methods stay intact for the wrappers above.
  return {
    ...rec,
    ...port,
    txs,
    failAfter(n: number | null) {
      left = n;
    },
  };
}
