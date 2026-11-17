// The reader's data layer: loading a text with an offline fallback, the learner's word
// statuses, and the writes (save, known, ignore, phrase, report, reading position), which all
// go through the outbox so they survive being offline.
import type { LemmaStatus, TextDetail, UpdateText } from '@app/contracts';
import { api, isApiError } from '../../lib/api';
import {
  type AppDb,
  db,
  getStoredText,
  type OutboxRow,
  outbox,
  registerMerger,
  setLemmaStatuses,
  storeText,
} from '../../lib/db';
import { newId } from '../../lib/ids';
import { isTappable, type Phrase, type WordInfo } from './analysis';

/** Query key of one text in the reader (server copy or the stored one). */
export const textKey = (id: string) => ['reader', 'text', id] as const;

export interface LoadedText {
  text: TextDetail;
  /** The learner's status per lemma id: the server's, with local writes not yet sent on top. */
  statuses: Record<string, LemmaStatus>;
  /** True when the server could not be reached and the stored copy is shown. */
  offline: boolean;
}

/** Thrown when there is neither a connection nor a stored copy of the text. */
export class OfflineMissingError extends Error {
  constructor() {
    super('offline and not stored');
    this.name = 'OfflineMissingError';
  }
}

/** Lemma ids of the text, as strings. */
function lemmaIdsOf(text: TextDetail): string[] {
  const ids = new Set<string>();
  for (const s of text.analysis?.sentences ?? []) {
    for (const t of s.tokens) if (isTappable(t)) ids.add(String(t.l));
  }
  return [...ids];
}

/** Lemmas with a status write still waiting in the outbox: the local status wins for them. */
export async function pendingLemmaIds(database: AppDb = db): Promise<Set<string>> {
  const rows = (await database.outbox.toArray()) as OutboxRow[];
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.status === 'failed') continue;
    if (r.name === 'lemmas.setStatus') {
      ids.add(String((r as OutboxRow<'lemmas.setStatus'>).input.params.id));
    } else if (r.name === 'notes.create') {
      const body = (r as OutboxRow<'notes.create'>).input.body;
      if (body.kind === 'word') ids.add(String(body.lemmaId));
    }
  }
  return ids;
}

/**
 * The server's statuses replace the local ones, except for lemmas whose own write is still
 * waiting to be sent. The local table is updated so the next offline visit agrees.
 */
export async function mergeStatuses(
  text: TextDetail,
  fromServer: boolean,
  database: AppDb = db,
): Promise<Record<string, LemmaStatus>> {
  const ids = lemmaIdsOf(text);
  const local = await database.lemmaStatus.bulkGet(ids.map(Number));
  const pending = fromServer ? await pendingLemmaIds(database) : null;
  const out: Record<string, LemmaStatus> = {};
  const toStore: { lemmaId: number; status: LemmaStatus }[] = [];
  ids.forEach((id, k) => {
    const server = text.lemmaStatus[id];
    const row = local[k];
    if (!fromServer || pending?.has(id)) {
      // Offline copy, or a write not yet sent: the newest local status counts.
      const status = row?.status ?? server;
      if (status) out[id] = status;
      return;
    }
    const status = server ?? 'unknown';
    out[id] = status;
    if (row?.status !== status) toStore.push({ lemmaId: Number(id), status });
  });
  if (toStore.length > 0) await setLemmaStatuses(toStore, database);
  return out;
}

/** Loads a text from the server and stores it; offline, falls back to the stored copy. */
export async function loadText(
  id: string,
  signal?: AbortSignal,
  database: AppDb = db,
): Promise<LoadedText> {
  try {
    const text = await api.texts.get({ params: { id } }, signal ? { signal } : {});
    if (text.status === 'ready' && text.analysis) {
      // Keep a translation that was fetched before if the server copy lacks it.
      const stored = await getStoredText(id, database);
      await storeText(withTranslations(text, stored), database);
    }
    const statuses = await mergeStatuses(text, true, database);
    return { text, statuses, offline: false };
  } catch (e) {
    if (!isApiError(e) || !e.isNetwork) throw e;
    const stored = await getStoredText(id, database);
    if (!stored) throw new OfflineMissingError();
    const { openedAt: _openedAt, ...text } = stored;
    const statuses = await mergeStatuses(text, false, database);
    return { text, statuses, offline: true };
  }
}

function withTranslations(text: TextDetail, stored: TextDetail | undefined): TextDetail {
  if (!stored?.analysis || !text.analysis) return text;
  const old = stored.analysis.sentences;
  return {
    ...text,
    analysis: {
      ...text.analysis,
      sentences: text.analysis.sentences.map((s, i) =>
        s.en === undefined && old[i]?.en !== undefined && old[i]?.s === s.s
          ? { ...s, en: old[i]?.en }
          : s,
      ),
    },
  };
}

// --- Writes -------------------------------------------------------------------------------

/** Status a word takes in the reader the moment the learner saves it. */
export const SAVED_STATUS: LemmaStatus = 'learning';

/** Save: `POST /notes` with the sentence as context. The colour changes at once. */
export async function saveWord(
  textId: string,
  info: WordInfo,
  sentence: { sk: string; en?: string | undefined },
  database: AppDb = db,
): Promise<void> {
  await setLemmaStatuses([{ lemmaId: info.lemmaId, status: SAVED_STATUS }], database);
  await outbox.enqueue('notes.create', {
    body: {
      id: newId(),
      kind: 'word',
      source: 'reader',
      lemmaId: info.lemmaId,
      textId,
      context: {
        sentenceSk: sentence.sk,
        ...(sentence.en ? { sentenceEn: sentence.en } : {}),
        blank: info.blank,
        ...(info.tag ? { tag: info.tag } : {}),
      },
    },
  });
}

/** Known or Ignore: `PUT /lemmas/:id/status`, sent later when offline. */
export async function setWordStatus(
  lemmaId: number,
  status: LemmaStatus,
  database: AppDb = db,
): Promise<void> {
  await setLemmaStatuses([{ lemmaId, status }], database);
  await outbox.enqueue('lemmas.setStatus', { params: { id: lemmaId }, body: { status } });
}

export async function savePhrase(textId: string, phrase: Phrase, glossEn: string): Promise<void> {
  await outbox.enqueue('notes.create', {
    body: {
      id: newId(),
      kind: 'phrase',
      source: 'reader',
      textId,
      content: {
        kind: 'phrase',
        textSk: phrase.textSk,
        glossEn,
        context: {
          sentenceSk: phrase.sentenceSk,
          sentenceEn: phrase.sentenceEn,
          blank: phrase.blank,
        },
      },
    },
  });
}

/** The reference a report carries: text, sentence, token and the word itself. */
export function tokenRef(textId: string, info: WordInfo): string {
  return `${textId}:${info.sentence}:${info.token}:${info.surface}`;
}

export async function reportToken(textId: string, info: WordInfo, comment: string) {
  await outbox.enqueue('reports.create', {
    body: {
      id: newId(),
      targetKind: 'analysis_token',
      targetRef: tokenRef(textId, info),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    },
  });
}

/** Translation on request; the answer is kept in the stored analysis for offline reading. */
export async function translateSentence(
  textId: string,
  n: number,
  database: AppDb = db,
): Promise<string> {
  const res = await api.texts.translateSentence({ params: { id: textId, n } });
  const stored = await getStoredText(textId, database);
  if (stored?.analysis) {
    const sentences = stored.analysis.sentences.map((s, i) =>
      i === res.n ? { ...s, en: res.en } : s,
    );
    await database.texts.put({ ...stored, analysis: { ...stored.analysis, sentences } });
  }
  return res.en;
}

/** Reading position: kept locally at once, sent through the outbox. */
export async function saveProgress(textId: string, sentence: number, database: AppDb = db) {
  const stored = await getStoredText(textId, database);
  if (stored) await database.texts.put({ ...stored, progress: { ...stored.progress, sentence } });
  const body: UpdateText = { progress: { sentence } };
  await outbox.enqueue('texts.update', { params: { id: textId }, body });
}

// Two waiting position updates of the same text become one request.
registerMerger('texts.update', (a, b) =>
  a.params.id === b.params.id ? { params: a.params, body: { ...a.body, ...b.body } } : null,
);
