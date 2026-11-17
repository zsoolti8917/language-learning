// The harvest: Tatoeba sentences that have an English translation, and the sentences of the
// UD Slovak SNK treebank with their checked lemmas and tags.
import { join } from 'node:path';
import { tokenize } from '@app/ling';
import { existsSync } from '../../lib/files';
import { readLines } from '../../lib/lines';
import type { UdWord } from './analyze';

export const TATOEBA_SOURCE = 'tatoeba';
export const TATOEBA_FILES = {
  slk: 'slk_sentences.tsv.bz2',
  eng: 'eng_sentences.tsv.bz2',
  links: 'slk-eng_links.tsv.bz2',
} as const;
export const TATOEBA_LICENSE = 'CC BY 2.0 FR';

export const UD_SOURCE = 'ud-slovak-snk';
export const UD_SPLITS = ['train', 'dev', 'test'] as const;
export const udFile = (split: string) => `sk_snk-ud-${split}.conllu`;
export const UD_LICENSE = 'CC BY-SA 4.0';

export interface HarvestedSentence {
  /** `tat-<number>` or `ud-<split>-<file>-<sentence>`. */
  id: string;
  source: 'tatoeba' | 'ud';
  /** The source's own id: the Tatoeba number, or the treebank's `sent_id`. */
  sourceRef: string;
  license: string;
  textSk: string;
  /** Tatoeba's English translation. Treebank sentences have none. */
  textEn?: string;
  /** The treebank's words. */
  ud?: UdWord[];
}

/** A cheap first look: 4 to 12 words and no number, before any lexicon work. */
export function roughlyFits(text: string, min: number, max: number): boolean {
  let words = 0;
  for (const t of tokenize(text)) {
    if (t.t === 'num') return false;
    if (t.t === 'word') words++;
  }
  return words >= min && words <= max;
}

export interface HarvestOptions {
  minWords: number;
  maxWords: number;
}

/**
 * Tatoeba: every Slovak sentence linked to an English one, with the English sentence of the
 * lowest id. Of sentences written the same way, the lowest id is kept.
 */
export async function readTatoeba(dir: string, opts: HarvestOptions): Promise<HarvestedSentence[]> {
  const links = new Map<string, string>();
  for await (const line of readLines(join(dir, TATOEBA_FILES.links))) {
    const [sk, en] = line.split('\t');
    if (!sk || !en) continue;
    const prev = links.get(sk);
    if (prev === undefined || Number(en) < Number(prev)) links.set(sk, en.trim());
  }
  const byText = new Map<string, { id: string; text: string }>();
  for await (const line of readLines(join(dir, TATOEBA_FILES.slk))) {
    const [id, , text] = line.split('\t');
    if (!id || text === undefined || !links.has(id)) continue;
    const t = text.trim();
    if (!roughlyFits(t, opts.minWords, opts.maxWords)) continue;
    const prev = byText.get(t);
    if (!prev || Number(id) < Number(prev.id)) byText.set(t, { id, text: t });
  }
  const wanted = new Set([...byText.values()].map((s) => links.get(s.id) as string));
  const english = new Map<string, string>();
  for await (const line of readLines(join(dir, TATOEBA_FILES.eng))) {
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (!wanted.has(id)) continue;
    const text = line.slice(line.indexOf('\t', tab + 1) + 1).trim();
    if (text) english.set(id, text);
  }
  const out: HarvestedSentence[] = [];
  for (const s of byText.values()) {
    const en = english.get(links.get(s.id) as string);
    if (!en) continue;
    out.push({
      id: `tat-${s.id}`,
      source: 'tatoeba',
      sourceRef: s.id,
      license: TATOEBA_LICENSE,
      textSk: s.text,
      textEn: en,
    });
  }
  return out.sort((a, b) => Number(a.sourceRef) - Number(b.sourceRef));
}

export interface ConlluSentence {
  sentId: string;
  /** `# orig_file_sentence`, such as `001#1`. */
  orig?: string;
  text: string;
  words: UdWord[];
}

/**
 * Parses one CoNLL-U sentence block. Each surface token is placed in the text from left to
 * right; a multiword token (*aby* = *aby* + *by*) has no single analysis and is left out.
 * Returns null without `# text`.
 */
export function parseConllu(block: string): ConlluSentence | null {
  let sentId = '';
  let orig: string | undefined;
  let text: string | undefined;
  const rows: string[][] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('# sent_id = ')) sentId = line.slice(12).trim();
    else if (line.startsWith('# text = ')) text = line.slice(9);
    else if (line.startsWith('# orig_file_sentence ')) orig = line.slice(21).trim();
    else if (line && !line.startsWith('#')) rows.push(line.split('\t'));
  }
  if (text === undefined) return null;
  const words: UdWord[] = [];
  let cursor = 0;
  let skipUntil = 0;
  for (const r of rows) {
    const id = r[0] ?? '';
    if (id.includes('.')) continue; // empty nodes
    const form = r[1] ?? '';
    const range = /^(\d+)-(\d+)$/u.exec(id);
    const at = text.indexOf(form, cursor);
    if (range) {
      if (at >= 0) cursor = at + form.length;
      skipUntil = Number(range[2]);
      continue;
    }
    if (Number(id) <= skipUntil) continue;
    if (at < 0) break;
    cursor = at + form.length;
    words.push({ s: at, e: cursor, form, lemma: r[2] ?? '', xpos: r[4] ?? '' });
  }
  return { sentId, ...(orig ? { orig } : {}), text, words };
}

/** The treebank's sentences of one split file. */
export async function readUd(
  path: string,
  split: string,
  opts: HarvestOptions,
): Promise<HarvestedSentence[]> {
  const out: HarvestedSentence[] = [];
  let block: string[] = [];
  let n = 0;
  const flush = () => {
    if (block.length === 0) return;
    n++;
    const s = parseConllu(block.join('\n'));
    block = [];
    if (!s) return;
    const text = s.text.trim();
    if (text !== s.text) return; // offsets would shift; the treebank's texts are trimmed
    if (!roughlyFits(text, opts.minWords, opts.maxWords)) return;
    const local = (s.orig ?? String(n).padStart(5, '0')).replace(/[^\w]+/gu, '-');
    out.push({
      id: `ud-${split}-${local}`,
      source: 'ud',
      sourceRef: s.sentId || `${split}:${n}`,
      license: UD_LICENSE,
      textSk: text,
      ud: s.words,
    });
  };
  for await (const line of readLines(path)) {
    if (line.trim() === '') flush();
    else block.push(line);
  }
  flush();
  return out;
}

/** Both sources. A missing treebank split is skipped. */
export async function harvest(
  raw: string,
  opts: HarvestOptions,
): Promise<{ tatoeba: HarvestedSentence[]; ud: HarvestedSentence[] }> {
  const tatoeba = await readTatoeba(join(raw, TATOEBA_SOURCE), opts);
  const ud: HarvestedSentence[] = [];
  for (const split of UD_SPLITS) {
    const p = join(raw, UD_SOURCE, udFile(split));
    if (existsSync(p)) ud.push(...(await readUd(p, split, opts)));
  }
  return { tatoeba, ud };
}
