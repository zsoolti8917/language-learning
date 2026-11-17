// Stand ins for NotesPort and AttemptsPort: recorders that keep every call in memory, per
// learner, so a test can assert what a module asked for. They need a real `withUser`
// transaction, because they read the learner from it. B1 and B5 replace them.
import type { BucketMastery, LemmaStatus, LemmaStatusSource, MasteryLevel } from '@app/contracts';
import { ALL_BUCKETS, bucketKey, bucketOf } from '@app/ling';
import { currentUserId } from '../platform/tx';
import type {
  AttemptRecord,
  AttemptsPort,
  CaseSentenceNoteInput,
  IdGenerator,
  NotesPort,
  PhraseNoteInput,
  Tx,
  WordNoteInput,
} from '../ports';

export type RecordedNote =
  | { noteId: string; userId: string; kind: 'word'; input: WordNoteInput; suspended: boolean }
  | { noteId: string; userId: string; kind: 'phrase'; input: PhraseNoteInput; suspended: boolean }
  | {
      noteId: string;
      userId: string;
      kind: 'case_sentence';
      input: CaseSentenceNoteInput;
      suspended: boolean;
    };

export interface NotesRecorder extends NotesPort {
  readonly notes: RecordedNote[];
  readonly statusCalls: {
    userId: string;
    lemmaIds: number[];
    status: LemmaStatus;
    source: LemmaStatusSource;
  }[];
  /** The learner's last status of a lemma, or undefined. */
  statusOf(userId: string, lemmaId: number): LemmaStatus | undefined;
  reset(): void;
}

export function createNotesRecorder(ids: IdGenerator): NotesRecorder {
  const notes: RecordedNote[] = [];
  const statusCalls: NotesRecorder['statusCalls'] = [];

  function add(note: RecordedNote): { noteId: string; created: boolean } {
    notes.push(note);
    return { noteId: note.noteId, created: true };
  }

  return {
    notes,
    statusCalls,
    async createWordNote(tx: Tx, input) {
      const userId = await currentUserId(tx);
      const same = notes.find(
        (n) => n.userId === userId && n.kind === 'word' && n.input.lemmaId === input.lemmaId,
      );
      if (same) return { noteId: same.noteId, created: false };
      return add({ noteId: input.id ?? ids.uuid(), userId, kind: 'word', input, suspended: false });
    },
    async createPhraseNote(tx, input) {
      const userId = await currentUserId(tx);
      const same = input.id && notes.find((n) => n.userId === userId && n.noteId === input.id);
      if (same) return { noteId: same.noteId, created: false };
      return add({
        noteId: input.id ?? ids.uuid(),
        userId,
        kind: 'phrase',
        input,
        suspended: false,
      });
    },
    async createCaseSentenceNote(tx, input) {
      const userId = await currentUserId(tx);
      const ex = input.content.exerciseId;
      const same = notes.find(
        (n) =>
          n.userId === userId &&
          ((input.id !== undefined && n.noteId === input.id) ||
            (ex !== undefined && n.kind === 'case_sentence' && n.input.content.exerciseId === ex)),
      );
      if (same) return { noteId: same.noteId, created: false };
      return add({
        noteId: input.id ?? ids.uuid(),
        userId,
        kind: 'case_sentence',
        input,
        suspended: false,
      });
    },
    async suspendNote(tx, noteId) {
      const userId = await currentUserId(tx);
      for (const n of notes) if (n.userId === userId && n.noteId === noteId) n.suspended = true;
    },
    async setLemmaStatus(tx, lemmaIds, status, source) {
      const userId = await currentUserId(tx);
      statusCalls.push({ userId, lemmaIds: [...lemmaIds], status, source });
    },
    statusOf(userId, lemmaId) {
      for (let i = statusCalls.length - 1; i >= 0; i--) {
        const c = statusCalls[i];
        if (c && c.userId === userId && c.lemmaIds.includes(lemmaId)) return c.status;
      }
      return undefined;
    },
    reset() {
      notes.length = 0;
      statusCalls.length = 0;
    },
  };
}

export interface AttemptsRecorder extends AttemptsPort {
  readonly attempts: (AttemptRecord & { userId: string })[];
  reset(): void;
}

/** Stand in mastery: the share of correct first tries; not the formula B5 builds. */
function levelOf(attempts: number, mastery: number): MasteryLevel {
  if (attempts === 0) return 'unseen';
  if (mastery < 0.6) return 'weak';
  if (mastery < 0.85) return 'ok';
  return 'strong';
}

export function createAttemptsRecorder(): AttemptsRecorder {
  const attempts: AttemptsRecorder['attempts'] = [];
  return {
    attempts,
    async record(tx, list) {
      const userId = await currentUserId(tx);
      for (const a of list) {
        if (attempts.some((x) => x.userId === userId && x.id === a.id)) continue;
        attempts.push({ ...a, userId });
      }
    },
    async getMastery(tx) {
      const userId = await currentUserId(tx);
      const stats = new Map<string, { n: number; ok: number }>();
      for (const a of attempts) {
        if (a.userId !== userId || a.retry) continue;
        const b = bucketOf(a);
        if (!b) continue;
        const s = stats.get(bucketKey(b)) ?? { n: 0, ok: 0 };
        s.n += 1;
        if (a.correct) s.ok += 1;
        stats.set(bucketKey(b), s);
      }
      return ALL_BUCKETS.map((b): BucketMastery => {
        const s = stats.get(bucketKey(b)) ?? { n: 0, ok: 0 };
        const mastery = s.n === 0 ? 0 : s.ok / s.n;
        return { ...b, attempts: s.n, mastery, level: levelOf(s.n, mastery) };
      });
    },
    reset() {
      attempts.length = 0;
    },
  };
}
