// The shared suite of NotesPort. The recorder and B1's real port both pass it.
import type { CaseSentenceContent, PhraseContent } from '@app/contracts';
import { UuidSchema } from '@app/contracts';
import { uuidv7 } from '@app/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotesPort, PortContext } from '../../ports';
import { createSuiteEnv, type SharedSuiteEnv, type SuiteEnv } from './context';

/** A case sentence of the mini dataset (exercise ex-140da36a9f). */
export const BRATA_CASE_SENTENCE: CaseSentenceContent = {
  kind: 'case_sentence',
  exerciseId: 'ex-140da36a9f',
  sentenceSk: 'Vidím brata.',
  sentenceEn: 'I see my brother.',
  blank: { start: 6, end: 11 },
  cue: 'brat',
  answers: ['brata'],
  features: { case: 'acc', number: 'sg', gender: 'm_anim' },
  lemmaId: 3,
  triggerId: 'verb-vidiet',
};

/** A phrase of the mini dataset. */
export const V_MESTE_PHRASE: PhraseContent = {
  kind: 'phrase',
  textSk: 'v meste',
  glossEn: 'in town',
  context: {
    sentenceSk: 'Bývam v meste.',
    sentenceEn: 'I live in town.',
    blank: { start: 6, end: 13 },
  },
};

export function runNotesSuite(
  name: string,
  make: (ctx: PortContext) => NotesPort | Promise<NotesPort>,
  shared?: SharedSuiteEnv,
): void {
  describe(`NotesPort suite: ${name}`, () => {
    let env: SuiteEnv;
    let port: NotesPort;
    beforeAll(async () => {
      env = shared ? shared() : await createSuiteEnv();
      port = await make(env.ctx);
    });
    afterAll(async () => {
      if (!shared) await env.close();
    });

    it('creates one word note per learner and lemma', async () => {
      const a = await env.learner();
      const b = await env.learner();
      const first = await env.db.withUser(a, (tx) =>
        port.createWordNote(tx, { lemmaId: 20, source: 'words' }),
      );
      const again = await env.db.withUser(a, (tx) =>
        port.createWordNote(tx, { lemmaId: 20, source: 'reader' }),
      );
      const other = await env.db.withUser(b, (tx) =>
        port.createWordNote(tx, { lemmaId: 20, source: 'words' }),
      );
      UuidSchema.parse(first.noteId);
      expect(first.created).toBe(true);
      expect(again).toEqual({ noteId: first.noteId, created: false });
      expect(other.created).toBe(true);
      expect(other.noteId).not.toBe(first.noteId);
    });

    it('uses the given id for a new word note', async () => {
      const a = await env.learner();
      const id = uuidv7();
      const r = await env.db.withUser(a, (tx) =>
        port.createWordNote(tx, { id, lemmaId: 12, source: 'manual' }),
      );
      expect(r).toEqual({ noteId: id, created: true });
    });

    it('creates one case sentence note per exercise', async () => {
      const a = await env.learner();
      const first = await env.db.withUser(a, (tx) =>
        port.createCaseSentenceNote(tx, { source: 'declension', content: BRATA_CASE_SENTENCE }),
      );
      const again = await env.db.withUser(a, (tx) =>
        port.createCaseSentenceNote(tx, { source: 'declension', content: BRATA_CASE_SENTENCE }),
      );
      expect(first.created).toBe(true);
      expect(again).toEqual({ noteId: first.noteId, created: false });
    });

    it('a phrase note with a repeated id is created once', async () => {
      const a = await env.learner();
      const id = uuidv7();
      const input = { id, source: 'reader' as const, content: V_MESTE_PHRASE };
      const first = await env.db.withUser(a, (tx) => port.createPhraseNote(tx, input));
      const again = await env.db.withUser(a, (tx) => port.createPhraseNote(tx, input));
      expect(first).toEqual({ noteId: id, created: true });
      expect(again).toEqual({ noteId: id, created: false });
    });

    it('suspends a note and sets lemma statuses for a list', async () => {
      const a = await env.learner();
      await env.db.withUser(a, async (tx) => {
        const { noteId } = await port.createWordNote(tx, { lemmaId: 21, source: 'words' });
        await port.suspendNote(tx, noteId);
        await port.setLemmaStatus(tx, [21, 24, 26], 'known', 'triage');
        await port.setLemmaStatus(tx, [], 'ignored', 'triage');
      });
    });
  });
}
