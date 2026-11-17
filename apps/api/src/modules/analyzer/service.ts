// Logic of the analyzer module. Owner: B3. Any pasted Slovak text becomes sentences and
// tokens; each word gets a lemma, a reading (form tag), how the reading was chosen, and its
// trigger. Rules decide first; the model is asked only about words they leave open.
// No transaction is held here: the database reads and the model calls run one after another.
import type { FormCandidate, TextAnalysis } from '@app/contracts';
import { foldAscii } from '@app/contracts';
import { splitSentences, tokenize } from '@app/ling';
import {
  type AiGateway,
  type DictionaryPort,
  isAiGatewayError,
  type MorphologyPort,
} from '../../ports';
import {
  contextOf,
  DisambiguationSchema,
  type OpenWord,
  packBatches,
  picksOf,
  systemPrompt,
} from './model';
import type { LemmaFacts, TriggerFacts } from './repo';
import {
  applyRules,
  assignTriggers,
  indexTriggers,
  type Option,
  type Phrase,
  type Word,
  type WorkSentence,
} from './rules';

export interface AnalyzerDeps {
  morphology: MorphologyPort;
  dictionary: DictionaryPort;
  ai: AiGateway;
  /** Lemma rows by id (one query). */
  lemmas(ids: number[]): Promise<LemmaFacts[]>;
  /** The trigger list. */
  triggers(): Promise<TriggerFacts[]>;
}

export interface AnalyzerResult {
  analysis: TextAnalysis;
  tokenCount: number;
  lemmaCounts: Record<number, number>;
}

const lower = (s: string) => s.normalize('NFC').toLowerCase();
const capitalised = (s: string) => /^\p{Lu}/u.test(s);

/**
 * True for a word written as a name inside a sentence: a capital, then small letters, after
 * another word or number of the same sentence. Slovak capitalises such a word only when it is
 * a name (*že Maja*, *podal mi Colu*); a word in capitals throughout is left alone.
 */
export function isNameInSentence(text: string, previous: 'word' | 'num' | 'punct' | undefined) {
  return (
    (previous === 'word' || previous === 'num') &&
    capitalised(text) &&
    /\p{Ll}/u.test(text.slice(1))
  );
}

/**
 * The readings of one word, the most frequent first. With `asName` (see `isNameInSentence`)
 * the accent fallback keeps only forms the data writes with a capital (*Zilina* → *Žilina*),
 * so a name the data lacks is not read as a common word with other accents (*Maja* is not
 * *mája*, a form of *máj*): it stays unknown rather than wrong. Readings of the exact
 * spelling are all kept (*Španielska občianska vojna* is the adjective, not *Španielsko*).
 */
export function optionsOf(
  text: string,
  candidates: readonly FormCandidate[],
  lemmas: ReadonlyMap<number, LemmaFacts>,
  asName = false,
): Option[] {
  // Prefer the forms written exactly so (capitals aside); fall back to forms that differ only
  // in accents, for text typed without them.
  const exact = candidates.filter((c) => lower(c.form) === lower(text));
  let pool = exact.length > 0 ? exact : candidates;
  // A name is never a common word spelled with other accents.
  if (asName && exact.length === 0) pool = pool.filter((c) => capitalised(c.form));
  const scored: { o: Option; rank: number; share: number; n: number }[] = [];
  const seen = new Set<string>();
  for (const c of pool) {
    const facts = lemmas.get(c.lemmaId);
    const rank = facts?.freqRank ?? c.freqRank ?? Number.MAX_SAFE_INTEGER;
    const readings = c.readings.length > 0 ? c.readings : [undefined];
    for (const r of readings) {
      const tag = r?.tag === '' ? undefined : r?.tag;
      const key = `${c.lemmaId}|${tag ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const share =
        facts?.topForms.find((f) => lower(f.form) === lower(c.form) && f.tag === (tag ?? ''))
          ?.share ?? 0;
      const o: Option = {
        lemmaId: c.lemmaId,
        lemma: facts?.lemma ?? c.lemma,
        pos: facts?.pos ?? c.pos,
        form: c.form,
        agrees: c.pos !== 'noun' && r?.gender !== undefined && r.case !== undefined,
      };
      if (tag !== undefined) o.tag = tag;
      if (r?.case) o.case = r.case;
      if (r?.number) o.number = r.number;
      if (r?.gender) o.gender = r.gender;
      scored.push({ o, rank, share, n: scored.length });
    }
  }
  scored.sort((a, b) => a.rank - b.rank || b.share - a.share || a.n - b.n);
  return scored.map((x) => x.o);
}

export async function analyzeText(
  deps: AnalyzerDeps,
  body: string,
  opts: { userId: string },
): Promise<AnalyzerResult> {
  // 1. Sentences and tokens, offsets into the body as given.
  const sentences: WorkSentence[] = splitSentences(body).map((sp) => {
    const tokens = tokenize(body.slice(sp.start, sp.end)).map((t) => ({
      s: t.s + sp.start,
      e: t.e + sp.start,
      t: t.t,
    }));
    return {
      s: sp.start,
      e: sp.end,
      tokens,
      texts: tokens.map((t) => body.slice(t.s, t.e).normalize('NFC')),
      words: tokens.map(() => null),
    };
  });

  // 2. One lookup of every distinct word form, then the lemmas and the trigger list.
  const forms = new Set<string>();
  for (const s of sentences)
    s.tokens.forEach((t, i) => {
      if (t.t === 'word') forms.add(s.texts[i] as string);
    });
  const found =
    forms.size > 0
      ? await deps.morphology.lookupForms([...forms])
      : new Map<string, FormCandidate[]>();
  const candidateLemmas = new Set<number>();
  for (const list of found.values()) for (const c of list) candidateLemmas.add(c.lemmaId);
  const [lemmaRows, triggerRows] = await Promise.all([
    deps.lemmas([...candidateLemmas]),
    deps.triggers(),
  ]);
  const lemmas = new Map(lemmaRows.map((l) => [l.id, l]));
  const triggers = indexTriggers(triggerRows);

  // 3. Readings per word, then the rules.
  const phrases: Phrase[][] = [];
  for (const s of sentences) {
    s.tokens.forEach((t, i) => {
      if (t.t !== 'word') return;
      const text = s.texts[i] as string;
      const asName = isNameInSentence(text, s.tokens[i - 1]?.t);
      const options = optionsOf(text, found.get(foldAscii(text)) ?? [], lemmas, asName);
      s.words[i] = { options, initial: options.length };
    });
    phrases.push(applyRules(s, triggers));
  }

  // 4. Words left open go to the model; identical words in identical contexts are asked once.
  const open = new Map<string, { item: OpenWord; words: Word[] }>();
  for (const s of sentences) {
    const sentenceText = body.slice(s.s, s.e);
    s.words.forEach((w, i) => {
      if (!w || w.options.length === 0) return;
      if (w.initial === 1) w.method = 'single';
      else if (w.options.length === 1) w.method = 'rule';
      else {
        const t = s.tokens[i] as { s: number; e: number };
        const item: OpenWord = {
          word: body.slice(t.s, t.e),
          context: contextOf(sentenceText, t.s - s.s, t.e - s.s),
          options: w.options,
        };
        const key = JSON.stringify([
          item.context,
          item.word,
          w.options.map((o) => `${o.lemmaId}|${o.tag ?? ''}`),
        ]);
        const entry = open.get(key) ?? { item, words: [] };
        entry.words.push(w);
        open.set(key, entry);
      }
    });
  }
  const entries = [...open.values()];
  const { batches } = packBatches(entries.map((e) => e.item));
  const chosen = new Map<OpenWord, number>();
  for (const batch of batches) {
    let picks: Map<number, number>;
    try {
      const { data } = await deps.ai.structured({
        route: 'reader.disambiguate',
        userId: opts.userId,
        system: systemPrompt(),
        messages: [{ role: 'user', content: batch.message }],
        schema: DisambiguationSchema,
        // No maxTokens: the route's limit leaves room for thinking (THINKING_ROOM_TOKENS).
      });
      picks = picksOf(batch, data);
    } catch (e) {
      // A refused, cut off or malformed answer leaves the words to the fallback; a used up
      // budget stops the import so the learner learns why.
      if (!isAiGatewayError(e) || e.code === 'budget_exceeded') throw e;
      picks = new Map();
    }
    for (const [n, c] of picks) chosen.set(batch.words[n] as OpenWord, c);
  }
  for (const { item, words } of entries) {
    const c = chosen.get(item);
    for (const w of words) {
      if (c !== undefined) {
        w.options = [w.options[c] as Option];
        w.method = 'model';
      } else {
        // The most frequent reading, marked as a guess.
        w.options = [w.options[0] as Option];
        w.method = 'guess';
      }
    }
  }

  // 5. Triggers, counts, glosses and the lemma map.
  const analysis: TextAnalysis = { v: 1, sentences: [], lemmas: {} };
  const lemmaCounts: Record<number, number> = {};
  let tokenCount = 0;
  sentences.forEach((s, si) => {
    assignTriggers(s, phrases[si] ?? [], triggers);
    analysis.sentences.push({
      s: s.s,
      e: s.e,
      tokens: s.tokens.map((t, i) => {
        if (t.t === 'word') tokenCount += 1;
        const w = s.words[i];
        const o = w?.options[0];
        if (!w || !o) return { s: t.s, e: t.e, t: t.t };
        lemmaCounts[o.lemmaId] = (lemmaCounts[o.lemmaId] ?? 0) + 1;
        return {
          s: t.s,
          e: t.e,
          t: t.t,
          l: o.lemmaId,
          ...(o.tag !== undefined ? { tag: o.tag } : {}),
          ...(w.method ? { m: w.method } : {}),
          ...(w.trig ? { trig: w.trig } : {}),
        };
      }),
    });
  });

  const ids = Object.keys(lemmaCounts).map(Number);
  const glosses = await glossesOf(
    deps.dictionary,
    ids,
    body.slice(sentences[0]?.s ?? 0, sentences[0]?.e ?? 0),
    opts.userId,
  );
  for (const id of ids) {
    const facts = lemmas.get(id);
    const fallback = findOption(sentences, id);
    const lemma = facts?.lemma ?? fallback?.lemma;
    const pos = facts?.pos ?? fallback?.pos;
    if (!lemma || !pos) continue;
    analysis.lemmas[String(id)] = {
      lemma,
      pos,
      ...(facts?.gender ? { gender: facts.gender } : {}),
      gloss: glosses.get(id) ?? [],
    };
  }
  return { analysis, tokenCount, lemmaCounts };
}

/** Glosses through DictionaryPort; when the model behind it fails, the stored senses. */
async function glossesOf(
  dictionary: DictionaryPort,
  ids: number[],
  sentenceSk: string,
  userId: string,
): Promise<Map<number, string[]>> {
  if (ids.length === 0) return new Map();
  try {
    return await dictionary.ensureGlosses(ids, { sentenceSk: sentenceSk.slice(0, 500), userId });
  } catch (e) {
    if (!isAiGatewayError(e) || e.code === 'budget_exceeded') throw e;
    const senses = await dictionary.getSenses(ids);
    return new Map(ids.map((id) => [id, (senses.get(id) ?? []).map((s) => s.glossEn)]));
  }
}

function findOption(sentences: readonly WorkSentence[], lemmaId: number): Option | undefined {
  for (const s of sentences)
    for (const w of s.words) {
      const o = w?.options[0];
      if (o?.lemmaId === lemmaId) return o;
    }
  return undefined;
}
