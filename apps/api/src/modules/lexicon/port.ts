// MorphologyPort and DictionaryPort of the lexicon module (B2). container.ts calls these two
// factories once per process; each port keeps a small cache in the process.
//
// Reads run as single statements on the login role (no transaction), or on the transaction
// a caller passes as the optional last argument. Do not call these ports from inside an open
// transaction without passing it: on PGlite (one connection) the read would wait for that
// transaction forever, and on Postgres it takes a second pooled connection.
import {
  type FormCandidate,
  foldAscii,
  type Lemma,
  type Paradigm,
  type Pos,
  type Sense,
} from '@app/contracts';
import type { Queryable } from '@app/db';
import {
  type DictionaryPort,
  isAiGatewayError,
  type MorphologyPort,
  type PortContext,
} from '../../ports';
import * as repo from './repo';
import {
  glossesToStore,
  glossRequest,
  LruCache,
  orderCandidates,
  toCandidate,
  toLemma,
  toParadigm,
  toSense,
  verifyCandidate,
} from './service';

export interface LexiconCacheOptions {
  /** Folded forms kept with their candidates (unknown forms included). Default 20 000. */
  forms?: number;
  /** Paradigms kept. Default 1 000. */
  paradigms?: number;
  /** Lemmas kept for getLemma. Default 5 000. */
  lemmas?: number;
}

/** The real MorphologyPort; every method also takes an optional transaction to read on. */
export interface LexiconMorphology extends MorphologyPort {
  lookupForms(forms: string[], tx?: Queryable): Promise<Map<string, FormCandidate[]>>;
  getParadigm(lemmaId: number, tx?: Queryable): Promise<Paradigm>;
  verifyForm(
    form: string,
    want: Parameters<MorphologyPort['verifyForm']>[1],
    tx?: Queryable,
  ): Promise<FormCandidate[]>;
  getLemma(lemmaId: number, tx?: Queryable): Promise<Lemma | null>;
  findLemma(text: string, pos?: Pos, tx?: Queryable): Promise<Lemma[]>;
  /** Drops every cached entry (after a content load in the same process). */
  clearCache(): void;
}

function freezeCandidate(c: FormCandidate): FormCandidate {
  for (const r of c.readings) Object.freeze(r);
  Object.freeze(c.readings);
  return Object.freeze(c);
}

export function createMorphologyPort(
  ctx: PortContext,
  cache: LexiconCacheOptions = {},
): LexiconMorphology {
  const db = () => ctx.database.db;
  const formCache = new LruCache<string, readonly FormCandidate[]>(cache.forms ?? 20_000);
  const paradigmCache = new LruCache<number, Paradigm>(cache.paradigms ?? 1_000);
  const lemmaCache = new LruCache<number, Lemma>(cache.lemmas ?? 5_000);

  /** The candidates of every key, from the cache or with one query for all missing keys. */
  async function candidatesOf(
    keys: readonly string[],
    tx: Queryable | undefined,
  ): Promise<Map<string, readonly FormCandidate[]>> {
    const found = new Map<string, readonly FormCandidate[]>();
    const missing: string[] = [];
    for (const k of keys) {
      const hit = formCache.get(k);
      if (hit) found.set(k, hit);
      else missing.push(k);
    }
    for (let i = 0; i < missing.length; i += repo.MAX_KEYS_PER_QUERY) {
      const chunk = missing.slice(i, i + repo.MAX_KEYS_PER_QUERY);
      const grouped = new Map<string, FormCandidate[]>(chunk.map((k) => [k, []]));
      for (const row of await repo.selectFormsByAscii(tx ?? db(), chunk))
        grouped.get(row.formAscii)?.push(freezeCandidate(toCandidate(row)));
      for (const [k, list] of grouped) {
        const frozen = Object.freeze(list);
        formCache.set(k, frozen);
        found.set(k, frozen);
      }
    }
    return found;
  }

  return {
    async lookupForms(forms, tx) {
      const firstInput = new Map<string, string>();
      for (const f of forms) {
        const k = foldAscii(f);
        if (!firstInput.has(k)) firstInput.set(k, f);
      }
      const found = await candidatesOf([...firstInput.keys()], tx);
      const out = new Map<string, FormCandidate[]>();
      for (const [k, input] of firstInput) out.set(k, orderCandidates(found.get(k) ?? [], input));
      return out;
    },

    async getParadigm(lemmaId, tx) {
      const hit = paradigmCache.get(lemmaId);
      if (hit) return hit;
      const q = tx ?? db();
      const l = await repo.selectLemma(q, lemmaId);
      if (!l) throw new Error(`unknown lemma ${lemmaId}`);
      const paradigm = toParadigm(l, await repo.selectFormsOfLemma(q, lemmaId));
      paradigmCache.set(lemmaId, paradigm);
      return paradigm;
    },

    async verifyForm(form, want, tx) {
      const k = foldAscii(form);
      const found = await candidatesOf([k], tx);
      const out: FormCandidate[] = [];
      for (const c of orderCandidates(found.get(k) ?? [], form)) {
        const ok = verifyCandidate(c, form, want);
        if (ok) out.push(ok);
      }
      return out;
    },

    async getLemma(lemmaId, tx) {
      const hit = lemmaCache.get(lemmaId);
      if (hit) return hit;
      const row = await repo.selectLemma(tx ?? db(), lemmaId);
      if (!row) return null;
      const l = toLemma(row);
      lemmaCache.set(lemmaId, l);
      return l;
    },

    async findLemma(text, pos, tx) {
      const rows = await repo.selectLemmasByAscii(tx ?? db(), foldAscii(text.trim()), pos);
      return rows.map(toLemma);
    },

    clearCache() {
      formCache.clear();
      paradigmCache.clear();
      lemmaCache.clear();
    },
  };
}

/** The real DictionaryPort; getSenses also takes an optional transaction to read on. */
export interface LexiconDictionary extends DictionaryPort {
  getSenses(lemmaIds: number[], tx?: Queryable): Promise<Map<number, Sense[]>>;
}

export function createDictionaryPort(ctx: PortContext): LexiconDictionary {
  const db = () => ctx.database.db;

  async function glossMap(q: Queryable, ids: readonly number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>(ids.map((id) => [id, []]));
    for (const s of await repo.selectSenses(q, ids)) out.get(s.lemmaId)?.push(s.glossEn);
    return out;
  }

  return {
    async getSenses(lemmaIds, tx) {
      const ids = [...new Set(lemmaIds)];
      const out = new Map<number, Sense[]>(ids.map((id) => [id, []]));
      for (const s of await repo.selectSenses(tx ?? db(), ids))
        out.get(s.lemmaId)?.push(toSense(s));
      return out;
    },

    /**
     * Stored glosses of every lemma. Lemmas that exist but have no sense are asked from the
     * route `reader.gloss` in one call (outside any transaction), stored with the source
     * `runtime`, and returned. Without `ctx.userId` (the budget and usage row need a learner)
     * or when the gateway fails, missing lemmas get an empty list and nothing is stored.
     * Unknown lemma ids get an empty list and are never asked.
     */
    async ensureGlosses(lemmaIds, opts) {
      const ids = [...new Set(lemmaIds)].filter((id) => Number.isInteger(id) && id > 0);
      const out = await glossMap(db(), ids);
      for (const id of lemmaIds) if (!out.has(id)) out.set(id, []);
      const missingIds = ids.filter((id) => (out.get(id) ?? []).length === 0);
      if (missingIds.length === 0 || !opts?.userId) return out;

      const lemmas = (await repo.selectLemmas(db(), missingIds)).map(toLemma);
      if (lemmas.length === 0) return out;

      let answer: Map<number, string[]>;
      try {
        const { data } = await ctx.ai.structured(
          glossRequest(lemmas, opts.userId, opts.sentenceSk),
        );
        answer = glossesToStore(data, new Set(lemmas.map((l) => l.id)));
      } catch (e) {
        if (isAiGatewayError(e)) return out;
        throw e;
      }
      if (answer.size === 0) return out;

      const stored = await ctx.database.withSystem(async (tx) => {
        // Another request may have stored glosses since the read above: keep those.
        const now = await glossMap(tx, [...answer.keys()]);
        const rows = [...answer]
          .filter(([id]) => (now.get(id) ?? []).length === 0)
          .flatMap(([lemmaId, glosses]) =>
            glosses.map((glossEn, ord) => ({ lemmaId, ord, glossEn })),
          );
        await repo.insertRuntimeGlosses(tx, rows);
        return glossMap(tx, [...answer.keys()]);
      });
      for (const [id, glosses] of stored) out.set(id, glosses);
      return out;
    },
  };
}
