// Logic of the words module. Owner: B6. It takes ports and a transaction and knows
// nothing about HTTP.
import type {
  LemmaDetail,
  LemmaStatus,
  RequestOutput,
  ResponseOf,
  TriageDecision,
} from '@app/contracts';
import { notFound, validationFailed } from '../../platform/errors';
import type { Ports, Tx } from '../../ports';
import * as repo from './repo';

/** Three bands of 1,000 ranks: 1-1000, 1001-2000, 2001-3000. */
export const BAND_SIZE = 1000;
export const BAND_COUNT = 3;
/** Sentences on the word page. */
export const WORD_PAGE_SENTENCES = 10;

export function bandRange(band: number): { fromRank: number; toRank: number } {
  return { fromRank: band * BAND_SIZE + 1, toRank: (band + 1) * BAND_SIZE };
}

export async function bands(tx: Tx): Promise<ResponseOf<'words.bands'>> {
  const out: ResponseOf<'words.bands'>['bands'] = [];
  for (let band = 0; band < BAND_COUNT; band++) {
    const { fromRank, toRank } = bandRange(band);
    const c = await repo.countBand(tx, fromRank, toRank);
    out.push({
      band,
      fromRank,
      toRank,
      total: c.total,
      known: c.known,
      learning: c.learning,
      // Ignored words are in the total but in none of the three counts.
      unknown: c.total - c.known - c.learning - c.ignored,
    });
  }
  return { bands: out };
}

/** The cursor is `<rank>.<lemmaId>` of the last item of the page. */
export function encodeCursor(rank: number, id: number): string {
  return `${rank}.${id}`;
}

export function decodeCursor(cursor: string): { rank: number; id: number } {
  const m = /^(\d{1,9})\.(\d{1,9})$/.exec(cursor);
  if (!m) throw validationFailed({ 'query.cursor': 'Invalid cursor.' });
  return { rank: Number(m[1]), id: Number(m[2]) };
}

export async function list(
  tx: Tx,
  query: RequestOutput<'words.list'>['query'],
): Promise<ResponseOf<'words.list'>> {
  if (query.band !== undefined && query.band >= BAND_COUNT)
    throw validationFailed({ 'query.band': `A band is 0 to ${BAND_COUNT - 1}.` });
  const range =
    query.band === undefined
      ? { fromRank: 1, toRank: BAND_COUNT * BAND_SIZE }
      : bandRange(query.band);
  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = await repo.listWords(tx, {
    ...range,
    status: query.status,
    after,
    limit: query.limit + 1,
  });
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.rank, last.lemmaId) : null,
  };
}

/**
 * Sorts many words in the caller's one transaction. A later decision for the same lemma wins.
 * Known and ignored set the status; learn creates a word note (and sets `learning`).
 */
export async function triage(
  tx: Tx,
  ports: Ports,
  body: RequestOutput<'words.triage'>['body'],
): Promise<ResponseOf<'words.triage'>> {
  const decided = new Map<number, TriageDecision>();
  for (const d of body.decisions) {
    decided.delete(d.lemmaId);
    decided.set(d.lemmaId, d.decision);
  }
  const existing = await repo.existingLemmaIds(tx, [...decided.keys()]);
  const fields: Record<string, string> = {};
  body.decisions.forEach((d, i) => {
    if (!existing.has(d.lemmaId)) fields[`body.decisions.${i}.lemmaId`] = 'Unknown lemma.';
  });
  if (Object.keys(fields).length > 0) throw validationFailed(fields);

  const by = (want: TriageDecision) => [...decided].filter(([, d]) => d === want).map(([id]) => id);
  const known = by('known');
  const ignored = by('ignored');
  const learn = by('learn');

  if (known.length > 0) await ports.notes.setLemmaStatus(tx, known, 'known', 'triage');
  if (ignored.length > 0) await ports.notes.setLemmaStatus(tx, ignored, 'ignored', 'triage');
  let notesCreated = 0;
  for (const lemmaId of learn) {
    const r = await ports.notes.createWordNote(tx, { lemmaId, source: 'words' });
    if (r.created) notesCreated += 1;
  }
  if (learn.length > 0) await ports.notes.setLemmaStatus(tx, learn, 'learning', 'triage');
  return { updated: decided.size, notesCreated };
}

/** `PUT /lemmas/:id/status`: learning creates the word note, the others set the status. */
export async function setStatus(
  tx: Tx,
  ports: Ports,
  lemmaId: number,
  status: LemmaStatus,
): Promise<ResponseOf<'lemmas.setStatus'>> {
  const exists = await repo.existingLemmaIds(tx, [lemmaId]);
  if (!exists.has(lemmaId)) throw notFound();
  if (status === 'learning') await ports.notes.createWordNote(tx, { lemmaId, source: 'words' });
  await ports.notes.setLemmaStatus(tx, [lemmaId], status, 'manual');
  return { lemmaId, status };
}

/**
 * The word page. The table of forms comes from MorphologyPort.getParadigm (every form with
 * its readings, in table order: singular cases, then plural); the rest is read here.
 */
export async function lemmaDetail(tx: Tx, ports: Ports, lemmaId: number): Promise<LemmaDetail> {
  const row = await repo.getLemma(tx, lemmaId);
  if (!row) throw notFound();
  const paradigm = await ports.morphology.getParadigm(lemmaId, tx);
  const [senses, sentences, status, noteId] = [
    await repo.getSenses(tx, lemmaId),
    await repo.getSentences(tx, lemmaId, WORD_PAGE_SENTENCES),
    await repo.getStatus(tx, lemmaId),
    await repo.getWordNoteId(tx, lemmaId),
  ];
  return {
    lemma: row,
    senses,
    forms: paradigm.forms,
    sentences: sentences.flatMap((s) => {
      const tok = s.tokens[s.tokenIndex];
      if (!tok) return [];
      return [
        {
          id: s.id,
          textSk: s.textSk,
          textEn: s.textEn,
          form: s.form,
          tag: s.tag,
          span: { start: tok.s, end: tok.e },
        },
      ];
    }),
    status,
    noteId,
  };
}
