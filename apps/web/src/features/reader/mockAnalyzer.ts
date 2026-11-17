// A tiny stand in for the API's text analyzer (B3), used only by the mock server. It splits
// and tokenizes with @app/ling, looks words up in a small dictionary of the example words,
// marks the case after a known preposition, and guesses the rest.
import type { AnalysisToken, Pos, TextAnalysis } from '@app/contracts';
import { splitSentences, tokenize } from '@app/ling';

type Entry = { l: number; tag?: string; m?: AnalysisToken['m'] };
type LemmaEntry = TextAnalysis['lemmas'][string];

/** Lemmas of the contract example (mini dataset ids). */
const LEMMAS: Record<number, LemmaEntry> = {
  64: { lemma: 'bývať', pos: 'verb', gloss: ['to live'] },
  50: { lemma: 'v', pos: 'prep', gloss: ['in'] },
  31: { lemma: 'Bratislava', pos: 'noun', gender: 'f', gloss: ['Bratislava'] },
  71: { lemma: 'dnes', pos: 'adv', gloss: ['today'] },
  62: { lemma: 'ísť', pos: 'verb', gloss: ['to go'] },
  45: { lemma: 'do', pos: 'prep', gloss: ['to, into'] },
  21: { lemma: 'kino', pos: 'noun', gender: 'n', gloss: ['cinema'] },
};

/** Forms of the example sentences, lower case. */
const FORMS: Record<string, Entry> = {
  bývam: { l: 64, tag: 'v:Kesa+' },
  v: { l: 50 },
  bratislave: { l: 31, tag: 's6' },
  dnes: { l: 71 },
  idem: { l: 62, tag: 'v:Kesa+' },
  do: { l: 45 },
  kina: { l: 21, tag: 's2' },
};

/** Prepositions that fix the case of the next word: lemma id → trigger id. */
const PREP_TRIGGERS: Record<number, string> = { 50: 'prep-v-loc', 45: 'prep-do' };

/** Lemma ids for guessed words start here, far from the registry. */
const GUESS_BASE = 900_000;

export function mockAnalyze(body: string): TextAnalysis {
  const lemmas: TextAnalysis['lemmas'] = {};
  const guessIds = new Map<string, number>();
  const sentences = splitSentences(body).map((span) => {
    const text = body.slice(span.start, span.end);
    const tokens: AnalysisToken[] = tokenize(text).map((tok) => ({
      s: tok.s + span.start,
      e: tok.e + span.start,
      t: tok.t,
    }));
    tokens.forEach((token, i) => {
      if (token.t !== 'word') return;
      const word = body.slice(token.s, token.e).toLowerCase();
      const known = FORMS[word];
      if (known) {
        token.l = known.l;
        if (known.tag) token.tag = known.tag;
        token.m = known.m ?? (known.tag === 's6' || known.tag === 's2' ? 'rule' : 'single');
        lemmas[String(known.l)] = LEMMAS[known.l] as LemmaEntry;
        const prev = tokens[i - 1];
        const trig = prev?.l !== undefined ? PREP_TRIGGERS[prev.l] : undefined;
        if (trig && known.tag?.startsWith('s')) {
          token.trig = { i: i - 1, kind: 'preposition', id: trig };
        }
        return;
      }
      let id = guessIds.get(word);
      if (id === undefined) {
        id = GUESS_BASE + guessIds.size;
        guessIds.set(word, id);
        lemmas[String(id)] = { lemma: word, pos: 'other' satisfies Pos, gloss: [] };
      }
      token.l = id;
      token.m = 'guess';
    });
    return { s: span.start, e: span.end, tokens };
  });
  return { v: 1, sentences, lemmas };
}
