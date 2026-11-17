// Stand in for AnalyzerPort: sentences and tokens from packages/ling, one lookup through
// MorphologyPort, the most frequent reading of each word, glosses through DictionaryPort.
// No rules, no triggers, no model. B3 replaces it.
import type { AnalysisToken, TextAnalysis } from '@app/contracts';
import { foldAscii } from '@app/contracts';
import { splitSentences, tokenize } from '@app/ling';
import type { AnalyzerPort, DictionaryPort, MorphologyPort } from '../ports';
import { markStandIn } from '../platform/stand-in';

export function createSimpleAnalyzer(deps: {
  morphology: () => MorphologyPort;
  dictionary: () => DictionaryPort;
}): AnalyzerPort {
  return markStandIn('analyzer', {
    async analyzeText(body) {
      const spans = splitSentences(body);
      const sentences = spans.map((sp) => ({
        s: sp.start,
        e: sp.end,
        tokens: tokenize(body.slice(sp.start, sp.end)).map((t) => ({
          s: t.s + sp.start,
          e: t.e + sp.start,
          t: t.t,
        })),
      }));
      const words = new Set<string>();
      for (const s of sentences)
        for (const t of s.tokens) if (t.t === 'word') words.add(body.slice(t.s, t.e));
      const found = await deps.morphology().lookupForms([...words]);

      const lemmaCounts: Record<number, number> = {};
      const analysis: TextAnalysis = { v: 1, sentences: [], lemmas: {} };
      let tokenCount = 0;
      const seen = new Set<number>();
      for (const s of sentences) {
        const tokens: AnalysisToken[] = s.tokens.map((t) => {
          if (t.t !== 'word') return t;
          tokenCount += 1;
          const cands = found.get(foldAscii(body.slice(t.s, t.e))) ?? [];
          const c = cands[0];
          if (!c) return t;
          lemmaCounts[c.lemmaId] = (lemmaCounts[c.lemmaId] ?? 0) + 1;
          seen.add(c.lemmaId);
          const single = cands.length === 1 && c.readings.length <= 1;
          const tag = c.readings[0]?.tag;
          return {
            ...t,
            l: c.lemmaId,
            ...(tag !== undefined ? { tag } : {}),
            m: single ? 'single' : 'guess',
          };
        });
        analysis.sentences.push({ s: s.s, e: s.e, tokens });
      }

      const ids = [...seen];
      const glosses = ids.length > 0 ? await deps.dictionary().ensureGlosses(ids) : new Map();
      for (const id of ids) {
        const lemma = await deps.morphology().getLemma(id);
        if (!lemma) continue;
        analysis.lemmas[String(id)] = {
          lemma: lemma.lemma,
          pos: lemma.pos,
          ...(lemma.gender ? { gender: lemma.gender } : {}),
          gloss: glosses.get(id) ?? [],
        };
      }
      return { analysis, tokenCount, lemmaCounts };
    },
  });
}
