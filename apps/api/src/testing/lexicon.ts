// Stand ins for MorphologyPort and DictionaryPort: the mini Slovak dataset, read from memory.
// B2 replaces them with the real ports in modules/lexicon/port.ts.
import type { FormCandidate, Lemma, Pos, Sense } from '@app/contracts';
import { foldAscii } from '@app/contracts';
import { readTags } from '@app/ling';
import { loadMini } from '@app/testkit/mini';
import { markStandIn } from '../platform/stand-in';
import type { DictionaryPort, MorphologyPort } from '../ports';

const lower = (s: string) => s.normalize('NFC').toLowerCase();

function lemmaOf(id: number): Lemma | null {
  const r = loadMini().lemmaById.get(id);
  if (!r) return null;
  return {
    id: r.id,
    key: r.key,
    lemma: r.lemma,
    pos: r.pos,
    gender: r.gender ?? null,
    pattern: r.pattern ?? null,
    aspect: r.aspect ?? null,
    freqRank: r.freqRank ?? null,
    topForms: r.topForms,
    flags: r.flags,
  };
}

let byFold: Map<string, FormCandidate[]> | undefined;

/** Every form of the dataset as a candidate, grouped by folded form. */
function index(): Map<string, FormCandidate[]> {
  if (byFold) return byFold;
  const mini = loadMini();
  byFold = new Map();
  for (const f of mini.forms) {
    const l = mini.lemmaById.get(f.lemmaId);
    if (!l) continue;
    const key = foldAscii(f.form);
    const list = byFold.get(key) ?? [];
    list.push({
      lemmaId: l.id,
      lemma: l.lemma,
      pos: l.pos,
      form: f.form,
      readings: readTags(f.tags, l.gender),
      freqRank: l.freqRank ?? null,
    });
    byFold.set(key, list);
  }
  return byFold;
}

const byRank = (a: FormCandidate, b: FormCandidate) =>
  (a.freqRank ?? Number.MAX_SAFE_INTEGER) - (b.freqRank ?? Number.MAX_SAFE_INTEGER);

export function createMiniMorphology(): MorphologyPort {
  return markStandIn('morphology', {
    async lookupForms(forms) {
      const out = new Map<string, FormCandidate[]>();
      for (const form of forms) {
        const key = foldAscii(form);
        const all = [...(index().get(key) ?? [])].sort(byRank);
        const exact = all.filter((c) => lower(c.form) === lower(form));
        out.set(key, [...exact, ...all.filter((c) => !exact.includes(c))]);
      }
      return out;
    },

    async getParadigm(lemmaId) {
      const rows = loadMini().formsByLemma.get(lemmaId);
      const l = loadMini().lemmaById.get(lemmaId);
      if (!rows || !l) throw new Error(`unknown lemma ${lemmaId}`);
      return {
        lemmaId,
        forms: rows.map((f) => ({ form: f.form, readings: readTags(f.tags, l.gender) })),
      };
    },

    async verifyForm(form, want) {
      const out: FormCandidate[] = [];
      for (const c of index().get(foldAscii(form)) ?? []) {
        if (lower(c.form) !== lower(form)) continue;
        if (want.lemmaId !== undefined && c.lemmaId !== want.lemmaId) continue;
        const readings = c.readings.filter(
          (r) =>
            (want.case === undefined || r.case === want.case) &&
            (want.number === undefined || r.number === want.number),
        );
        if (readings.length > 0 || (want.case === undefined && want.number === undefined))
          out.push({ ...c, readings });
      }
      return out;
    },

    async getLemma(lemmaId) {
      return lemmaOf(lemmaId);
    },

    async findLemma(text: string, pos?: Pos) {
      const key = foldAscii(text);
      return loadMini()
        .lemmas.filter((l) => foldAscii(l.lemma) === key && (pos === undefined || l.pos === pos))
        .map((l) => lemmaOf(l.id))
        .filter((l): l is Lemma => l !== null);
    },
  });
}

export function createMiniDictionary(): DictionaryPort {
  const senses = (id: number): Sense[] =>
    loadMini()
      .senses.filter((s) => s.lemmaId === id)
      .sort((a, b) => a.ord - b.ord)
      .map((s) => ({
        ord: s.ord,
        glossEn: s.glossEn,
        note: s.note ?? null,
        source: s.source,
        verified: s.verified,
      }));
  return markStandIn('dictionary', {
    async getSenses(lemmaIds) {
      return new Map(lemmaIds.map((id) => [id, senses(id)]));
    },
    // The stand in never asks the model: a lemma without a sense gets an empty list.
    async ensureGlosses(lemmaIds) {
      return new Map(lemmaIds.map((id) => [id, senses(id).map((s) => s.glossEn)]));
    },
  });
}
