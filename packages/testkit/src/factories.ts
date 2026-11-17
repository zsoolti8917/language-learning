// Factories: one per table of schema `app`. Each inserts a valid row with defaults,
// takes overrides, and returns the inserted row. They write through the owner
// connection (PGlite's superuser), so row level security does not stand in the way;
// test the policies through withUser.
//
// A factory that needs a parent makes one when none is given: `card()` makes a note,
// which makes a profile. Pass `userId` (and the parent id) to attach rows to a learner.
import type { NoteContent } from '@app/contracts';
import {
  aiCall,
  appText,
  attempt,
  card,
  contentReport,
  conversation,
  type Db,
  lessonProgress,
  message,
  note,
  placement,
  profile,
  review,
  tutorError,
  userLemma,
} from '@app/db';
import { uuidv7 } from './uuid';

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];
type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];
/** Overrides of a factory: every column is optional. */
type Over<T extends { $inferInsert: unknown }> = Partial<Insert<T>>;

/** Word note content for *mesto* (lemma 20 of the mini dataset). Pass it to `note()`. */
export const MESTO_WORD_CONTENT: NoteContent = {
  kind: 'word',
  lemmaId: 20,
  lemma: 'mesto',
  glossEn: 'town, city',
  variants: [
    {
      sentenceSk: 'Bývam v meste.',
      sentenceEn: 'I live in the town.',
      blank: { start: 8, end: 13 },
      answer: 'meste',
      tag: 's6',
    },
  ],
};

/** A phrase note: *v meste*, "in the town". The default content of `note()`. */
export const V_MESTE_PHRASE_CONTENT: NoteContent = {
  kind: 'phrase',
  textSk: 'v meste',
  glossEn: 'in the town',
  context: {
    sentenceSk: 'Bývam v meste.',
    sentenceEn: 'I live in the town.',
    blank: { start: 6, end: 13 },
  },
};

export interface Factories {
  profile(over?: Over<typeof profile>): Promise<Row<typeof profile>>;
  userLemma(over?: Over<typeof userLemma>): Promise<Row<typeof userLemma>>;
  note(over?: Over<typeof note>): Promise<Row<typeof note>>;
  card(over?: Over<typeof card>): Promise<Row<typeof card>>;
  review(over?: Over<typeof review>): Promise<Row<typeof review>>;
  attempt(over?: Over<typeof attempt>): Promise<Row<typeof attempt>>;
  lessonProgress(over?: Over<typeof lessonProgress>): Promise<Row<typeof lessonProgress>>;
  text(over?: Over<typeof appText>): Promise<Row<typeof appText>>;
  conversation(over?: Over<typeof conversation>): Promise<Row<typeof conversation>>;
  message(over?: Over<typeof message>): Promise<Row<typeof message>>;
  tutorError(over?: Over<typeof tutorError>): Promise<Row<typeof tutorError>>;
  placement(over?: Over<typeof placement>): Promise<Row<typeof placement>>;
  aiCall(over?: Over<typeof aiCall>): Promise<Row<typeof aiCall>>;
  contentReport(over?: Over<typeof contentReport>): Promise<Row<typeof contentReport>>;
}

/** The factory names, keyed by the table they fill. */
export const FACTORY_FOR_TABLE = {
  profile: 'profile',
  user_lemma: 'userLemma',
  note: 'note',
  card: 'card',
  review: 'review',
  attempt: 'attempt',
  lesson_progress: 'lessonProgress',
  text: 'text',
  conversation: 'conversation',
  message: 'message',
  tutor_error: 'tutorError',
  placement: 'placement',
  ai_call: 'aiCall',
  content_report: 'contentReport',
} as const satisfies Record<string, keyof Factories>;

export function createFactories(db: Db): Factories {
  let seq = 0;
  const one = <T>(rows: T[]): T => {
    const [row] = rows;
    if (!row) throw new Error('factory: insert returned no row');
    return row;
  };
  /** The given learner, or a new profile's id. */
  const owner = async (userId: string | undefined) => userId ?? (await f.profile()).userId;

  const f: Factories = {
    profile: async (over = {}) =>
      one(
        await db
          .insert(profile)
          .values({ userId: uuidv7(), displayName: `Learner ${++seq}`, ...over })
          .returning(),
      ),

    userLemma: async (over = {}) => {
      const userId = await owner(over.userId);
      return one(
        await db
          .insert(userLemma)
          .values({ lemmaId: 20, status: 'learning', source: 'manual', ...over, userId })
          .returning(),
      );
    },

    note: async (over = {}) => {
      const userId = await owner(over.userId);
      // The default is a phrase note: word notes are unique per learner and lemma.
      const content = over.content ?? V_MESTE_PHRASE_CONTENT;
      return one(
        await db
          .insert(note)
          .values({
            id: uuidv7(),
            kind: content.kind,
            lemmaId: 'lemmaId' in content ? (content.lemmaId ?? null) : null,
            content,
            source: 'manual',
            ...over,
            userId,
          })
          .returning(),
      );
    },

    card: async (over = {}) => {
      const userId = await owner(over.userId);
      const noteId = over.noteId ?? (await f.note({ userId })).id;
      return one(
        await db
          .insert(card)
          .values({ id: uuidv7(), newOrd: ++seq, ...over, userId, noteId })
          .returning(),
      );
    },

    review: async (over = {}) => {
      const userId = await owner(over.userId);
      const cardId = over.cardId ?? (await f.card({ userId })).id;
      return one(
        await db
          .insert(review)
          .values({
            id: uuidv7(),
            answeredAt: new Date(),
            rating: 3,
            grade: 'correct',
            typed: 'meste',
            expected: 'meste',
            ...over,
            userId,
            cardId,
          })
          .returning(),
      );
    },

    attempt: async (over = {}) => {
      const userId = await owner(over.userId);
      return one(
        await db
          .insert(attempt)
          .values({
            id: uuidv7(),
            source: 'trainer',
            lemmaId: 20,
            gCase: 'loc',
            gNumber: 'sg',
            gGender: 'n',
            pattern: 'mesto',
            triggerId: 'prep-v-loc',
            correct: true,
            diagnosis: 'correct',
            given: 'meste',
            expected: 'meste',
            occurredAt: new Date(),
            ...over,
            userId,
          })
          .returning(),
      );
    },

    lessonProgress: async (over = {}) => {
      const userId = await owner(over.userId);
      return one(
        await db
          .insert(lessonProgress)
          .values({
            lessonId: 'acc-sg',
            status: 'in_progress',
            startedAt: new Date(),
            ...over,
            userId,
          })
          .returning(),
      );
    },

    text: async (over = {}) => {
      const userId = await owner(over.userId);
      return one(
        await db
          .insert(appText)
          .values({
            id: uuidv7(),
            title: 'V meste',
            body: 'Bývam v meste.',
            source: 'paste',
            ...over,
            userId,
          })
          .returning(),
      );
    },

    conversation: async (over = {}) => {
      const userId = await owner(over.userId);
      return one(
        await db
          .insert(conversation)
          .values({ id: uuidv7(), scenarioId: 'scn-cafe-order', mode: 'scenario', ...over, userId })
          .returning(),
      );
    },

    message: async (over = {}) => {
      const userId = await owner(over.userId);
      const conversationId = over.conversationId ?? (await f.conversation({ userId })).id;
      return one(
        await db
          .insert(message)
          .values({
            id: uuidv7(),
            seq: ++seq,
            role: 'learner',
            content: 'Idem do mesta.',
            ...over,
            userId,
            conversationId,
          })
          .returning(),
      );
    },

    tutorError: async (over = {}) => {
      const userId = await owner(over.userId);
      const conversationId = over.conversationId ?? (await f.conversation({ userId })).id;
      const messageId =
        over.messageId ??
        (await f.message({ userId, conversationId, content: 'Idem do mesto.' })).id;
      return one(
        await db
          .insert(tutorError)
          .values({
            id: uuidv7(),
            spanStart: 8,
            spanEnd: 13,
            given: 'mesto',
            expected: 'mesta',
            errorType: 'case_after_preposition',
            caseExpected: 'gen',
            caseGiven: 'nom',
            lemmaId: 20,
            triggerId: 'prep-do',
            severity: 'case',
            status: 'prompted',
            ...over,
            userId,
            conversationId,
            messageId,
          })
          .returning(),
      );
    },

    placement: async (over = {}) => {
      const userId = await owner(over.userId);
      return one(
        await db
          .insert(placement)
          .values({ id: uuidv7(), ...over, userId })
          .returning(),
      );
    },

    aiCall: async (over = {}) => {
      const userId = await owner(over.userId);
      return one(
        await db
          .insert(aiCall)
          .values({
            id: uuidv7(),
            route: 'tutor.reply',
            model: 'claude-opus-5-5',
            inputTokens: 1200,
            outputTokens: 80,
            costUsd: '0.012000',
            status: 'ok',
            ...over,
            userId,
          })
          .returning(),
      );
    },

    contentReport: async (over = {}) => {
      const userId = await owner(over.userId);
      return one(
        await db
          .insert(contentReport)
          .values({
            id: uuidv7(),
            targetKind: 'exercise',
            targetRef: 'ex-3fa94c21d0',
            comment: 'The answer looks wrong.',
            ...over,
            userId,
          })
          .returning(),
      );
    },
  };
  return f;
}
