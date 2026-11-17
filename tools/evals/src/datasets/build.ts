// Builds the three eval datasets from the UD Slovak SNK treebank:
// - 300 correct sentences (the tutor must find no case error),
// - 300 sentences with one injected case error (the tutor must find exactly that one),
// - 500 sentences with the checked lemma and case of every word (the analyzer's gold).
// The three sets share no sentence. Selection and injection are seeded, so a build with the
// same inputs gives the same files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lexicon } from '../lexicon';
import { parseConllu, type UdSentence } from '../ud/conllu';
import { caseOf, numberOf } from '../ud/features';
import { injectError } from './inject';
import { createRng, hash32 } from './rng';
import type { AnalyzerCase, CorrectCase, DatasetManifest, GoldWord, InjectedCase } from './types';

export const DEFAULT_SIZES = { correct: 300, injected: 300, analyzer: 500 } as const;
export const DEFAULT_SEED = 20261117;
export const UD_FILES = ['sk_snk-ud-test.conllu', 'sk_snk-ud-dev.conllu', 'sk_snk-ud-train.conllu'];

export interface BuildOptions {
  seed?: number;
  sizes?: { correct: number; injected: number; analyzer: number };
  sources?: string[];
}

export interface Datasets {
  correct: CorrectCase[];
  injected: InjectedCase[];
  analyzer: AnalyzerCase[];
  manifest: DatasetManifest;
}

const MIN_WORDS = 5;
const MAX_WORDS = 20;
const MAX_CHARS = 220;
const CONTENT_UPOS = new Set(['NOUN', 'ADJ', 'VERB', 'DET', 'PRON', 'ADP']);

/**
 * A sentence fit for the evals: a whole sentence of 5 to 20 words, no multiword tokens, no
 * numbers or symbols, and every content word known to the morphology data, so a miss is the
 * model's and not a gap in the data.
 */
export function eligible(s: UdSentence, lexicon: Lexicon): boolean {
  if (s.multiword || s.text.length > MAX_CHARS) return false;
  const words = s.tokens.filter((t) => t.upos !== 'PUNCT');
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) return false;
  if (!/^\p{Lu}/u.test(s.text) || !/[.?!]$/.test(s.text)) return false;
  for (const t of s.tokens) {
    if (t.upos === 'X' || t.upos === 'SYM' || /\d/.test(t.form)) return false;
    if (t.form.includes('"') || t.form.includes('„') || t.form.includes('“')) return false;
    if (CONTENT_UPOS.has(t.upos)) {
      const lower = t.form.toLowerCase();
      if (!lexicon.rowsOf(t.form).some((r) => r.form.toLowerCase() === lower)) return false;
    }
  }
  return true;
}

function goldWords(s: UdSentence): GoldWord[] {
  return s.tokens
    .filter((t) => t.upos !== 'PUNCT')
    .map((t) => {
      const w: GoldWord = { s: t.s, e: t.e, form: t.form, lemma: t.lemma, upos: t.upos };
      const c = caseOf(t);
      const n = numberOf(t);
      if (c) w.case = c;
      if (n) w.number = n;
      return w;
    });
}

/** Builds the datasets from parsed treebank sentences. */
export function buildDatasets(
  sentences: readonly UdSentence[],
  lexicon: Lexicon,
  opts: BuildOptions = {},
): Datasets {
  const seed = opts.seed ?? DEFAULT_SEED;
  const sizes = opts.sizes ?? DEFAULT_SIZES;
  const seen = new Set<string>();
  const pool: UdSentence[] = [];
  for (const s of sentences) {
    if (seen.has(s.text) || !eligible(s, lexicon)) continue;
    seen.add(s.text);
    pool.push(s);
  }
  const order = createRng(seed).shuffle(pool);

  const injected: InjectedCase[] = [];
  const correct: CorrectCase[] = [];
  const analyzer: AnalyzerCase[] = [];
  let skipped = 0;
  // Sentences are dealt to the sets in turn (3 : 3 : 5), so no set gets the leftovers of
  // another. A sentence dealt to the injected set that cannot take an error is dropped, not
  // passed on: the correct set must not fill up with sentences that have no noun phrase.
  const deal = ['injected', 'correct', 'analyzer', 'analyzer', 'injected', 'correct', 'analyzer'];
  const full = (k: string) =>
    k === 'injected'
      ? injected.length >= sizes.injected
      : k === 'correct'
        ? correct.length >= sizes.correct
        : analyzer.length >= sizes.analyzer;
  let turn = 0;
  for (const s of order) {
    if (full('injected') && full('correct') && full('analyzer')) break;
    let target = deal[turn % deal.length] as string;
    for (let k = 0; full(target) && k < deal.length; k++)
      target = deal[(turn + k) % deal.length] as string;
    turn++;
    if (target === 'injected') {
      const inj = injectError(s, lexicon, createRng(hash32(`${seed}:${s.sentId}`)));
      if (!inj) {
        skipped++;
        continue;
      }
      injected.push({
        id: `inj-${injected.length + 1}`,
        sentId: s.sentId,
        text: inj.text,
        original: s.text,
        label: inj.label,
      });
    } else if (target === 'correct') {
      correct.push({ id: `cor-${correct.length + 1}`, sentId: s.sentId, text: s.text });
    } else {
      analyzer.push({
        id: `ana-${analyzer.length + 1}`,
        sentId: s.sentId,
        text: s.text,
        words: goldWords(s),
      });
    }
  }
  return {
    correct,
    injected,
    analyzer,
    manifest: {
      seed,
      sources: opts.sources ?? [],
      morphology: lexicon.label,
      counts: { correct: correct.length, injected: injected.length, analyzer: analyzer.length },
      injectionSkipped: skipped,
    },
  };
}

/** Reads the treebank files of a folder (`content/raw/ud-slovak-snk`). */
export function readTreebank(dir: string, files: readonly string[] = UD_FILES): UdSentence[] {
  const out: UdSentence[] = [];
  for (const f of files) {
    const path = join(dir, f);
    if (!existsSync(path)) continue;
    const split = /-ud-(\w+)\.conllu$/.exec(f)?.[1] ?? f;
    out.push(...parseConllu(readFileSync(path, 'utf8'), split));
  }
  if (out.length === 0)
    throw new Error(
      `No treebank file in ${dir}: run "pnpm run pipeline fetch --source ud-slovak-snk" first.`,
    );
  return out;
}

export const DATASET_FILES = {
  correct: 'tutor-correct.jsonl',
  injected: 'tutor-injected.jsonl',
  analyzer: 'analyzer-gold.jsonl',
  manifest: 'manifest.json',
} as const;

const jsonl = (rows: readonly unknown[]) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

export function writeDatasets(dir: string, d: Datasets): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, DATASET_FILES.correct), jsonl(d.correct));
  writeFileSync(join(dir, DATASET_FILES.injected), jsonl(d.injected));
  writeFileSync(join(dir, DATASET_FILES.analyzer), jsonl(d.analyzer));
  writeFileSync(join(dir, DATASET_FILES.manifest), `${JSON.stringify(d.manifest, null, 2)}\n`);
}

function readRows<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

export function readDatasets(dir: string): Datasets {
  if (!existsSync(join(dir, DATASET_FILES.manifest)))
    throw new Error(`No datasets in ${dir}: run "pnpm --filter @app/evals run evals build" first.`);
  return {
    correct: readRows(join(dir, DATASET_FILES.correct)),
    injected: readRows(join(dir, DATASET_FILES.injected)),
    analyzer: readRows(join(dir, DATASET_FILES.analyzer)),
    manifest: JSON.parse(readFileSync(join(dir, DATASET_FILES.manifest), 'utf8')),
  };
}
