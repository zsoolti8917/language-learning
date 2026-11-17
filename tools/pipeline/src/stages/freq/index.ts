// Stage 3, freq: Araneum frequency lists + OpenSubtitles word list + the morphology → a rank
// for the most common lemmas and their most used forms (docs/work-packages.md, C2).
// The formula is in rank.ts. Output: content/build/freq/lemmas.jsonl, merged by id onto the
// morph lemmas when validate assembles the set.
import { join } from 'node:path';
import type { Pos } from '@app/contracts';
import { existsSync, JsonlWriter, readJsonl, stableJson, writeFileAtomic } from '../../lib/files';
import { readLines } from '../../lib/lines';
import { codeDirOf, type Stage, type StageContext } from '../../lib/runner';
import type { Check } from '../../lib/validate';
import {
  DEFAULT_RANK_LIMIT,
  FreqBuilder,
  type FreqForm,
  type FreqLemma,
  type FreqResult,
  MorphIndex,
  SUB_WEIGHT,
  WEB_WEIGHT,
} from './rank';

export const ARANEUM_SOURCE = 'araneum-arf';
export const LEMMA_POS_FILE = 'dataset-arf-araneum-slovacum-vii-lemma-pos.tsv.xz';
export const WORD_TAG_FILE = 'dataset-arf-araneum-slovacum-vii-word-tag.tsv.xz';
export const SUBTITLE_SOURCE = 'frequencywords';
export const SUBTITLE_FILE = 'sk_full.txt';

export const freqOut = (root: { build: string }, f: string) => join(root.build, 'freq', f);

function inputsOf(ctx: StageContext) {
  return {
    lemmaPos: join(ctx.paths.raw, ARANEUM_SOURCE, LEMMA_POS_FILE),
    wordTag: join(ctx.paths.raw, ARANEUM_SOURCE, WORD_TAG_FILE),
    subtitles: join(ctx.paths.raw, SUBTITLE_SOURCE, SUBTITLE_FILE),
    lemmas: join(ctx.paths.build, 'morph', 'lemmas.jsonl'),
    forms: join(ctx.paths.build, 'morph', 'forms.jsonl'),
  };
}

function limitOf(ctx: StageContext): number {
  const n = Number(ctx.args.limit ?? DEFAULT_RANK_LIMIT);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--limit must be a positive integer`);
  return n;
}

/** Loads the morph output into the index the ranking needs. */
export async function loadMorphIndex(lemmasPath: string, formsPath: string): Promise<MorphIndex> {
  const index = new MorphIndex();
  for await (const l of readJsonl<FreqLemma>(lemmasPath)) index.addLemma(l);
  for await (const f of readJsonl<FreqForm>(formsPath)) index.addForm(f);
  return index;
}

const BANDS = [1000, 3000, 5000];

function renderReport(r: FreqResult, index: MorphIndex, limit: number, ms: number): string {
  const s = r.stats;
  const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : '–');
  const lemma = (id: number) => index.lemmas.get(id) as FreqLemma;
  const lines = [
    '# Frequency report',
    '',
    `Score = ${WEB_WEIGHT} · ln(web rank) + ${SUB_WEIGHT} · ln(subtitle rank); ${r.rows.length} lemmas ranked (limit ${limit}) of ${r.scored.length} with a score. ${(ms / 1000).toFixed(1)} s.`,
    '',
    '| Input | Rows | Matched |',
    '|---|---:|---:|',
    `| Araneum word + tag | ${s.wordTagRows.toLocaleString('en')} | ${s.matchedRows.toLocaleString('en')} rows, ${pct(s.matchedArf, s.wordTagArf)} of ARF (${s.ambiguousRows.toLocaleString('en')} split between lemmas, ${s.unparsedRows.toLocaleString('en')} tags not mapped) |`,
    `| Araneum lemma + class | ${s.lemmaPosRows.toLocaleString('en')} | used to split ambiguous rows |`,
    `| OpenSubtitles words | ${s.subtitleWords.toLocaleString('en')} | ${pct(s.matchedSubtitleCount, s.subtitleCount)} of tokens |`,
    '',
    '## Coverage of subtitle tokens by the top lemmas',
    '',
    '| Top | Share of matched subtitle tokens | Nouns | Verbs | Adjectives | Other |',
    '|---:|---:|---:|---:|---:|---:|',
  ];
  const totalSub = r.scored.reduce((a, x) => a + x.sub, 0);
  for (const n of BANDS) {
    const top = r.scored.slice(0, n);
    const count = (p: Pos) => top.filter((x) => lemma(x.id).pos === p).length;
    const sub = top.reduce((a, x) => a + x.sub, 0);
    const other = top.length - count('noun') - count('verb') - count('adj');
    lines.push(
      `| ${n.toLocaleString('en')} | ${pct(sub, totalSub)} | ${count('noun')} | ${count('verb')} | ${count('adj')} | ${other} |`,
    );
  }
  lines.push(
    '',
    '## Top 100',
    '',
    '| Rank | Lemma | Pos | Web rank | Subtitle rank | Top forms |',
    '|---:|---|---|---:|---:|---|',
  );
  for (const x of r.scored.slice(0, 100)) {
    const l = lemma(x.id);
    const row = r.rows[x.rank - 1];
    const forms = (row?.topForms ?? []).map((f) => `${f.form} ${f.tag} ${f.share}`).join(', ');
    lines.push(`| ${x.rank} | ${l.lemma} | ${l.pos} | ${x.webRank} | ${x.subRank} | ${forms} |`);
  }
  return `${lines.join('\n')}\n`;
}

export async function runFreq(ctx: StageContext): Promise<Record<string, unknown>> {
  const t0 = performance.now();
  const files = inputsOf(ctx);
  for (const [name, path] of Object.entries(files))
    if (!existsSync(path))
      throw new Error(
        `freq: ${path} (${name}) does not exist. Run "pnpm run pipeline fetch --source ${ARANEUM_SOURCE},${SUBTITLE_SOURCE}" and "pnpm run pipeline morph" first.`,
      );
  const limit = limitOf(ctx);
  const index = await loadMorphIndex(files.lemmas, files.forms);
  ctx.log(`freq: ${index.lemmas.size} lemmas, ${index.formCount} spellings`);
  const b = new FreqBuilder(index);
  await b.readLemmaPos(readLines(files.lemmaPos));
  ctx.log(`freq: lemma list read (${b.stats.lemmaPosRows} rows)`);
  await b.readWordTag(readLines(files.wordTag));
  ctx.log(`freq: word form list read (${b.stats.wordTagRows} rows)`);
  await b.readSubtitles(readLines(files.subtitles));
  const result = b.finish(limit);

  const w = await JsonlWriter.open(freqOut(ctx.paths, 'lemmas.jsonl'));
  for (const row of result.rows) await w.write(row);
  await w.close();
  const tsv = ['rank\tid\tkey\tscore\twebRank\tsubRank\tweb\tsub'];
  for (const x of result.scored.slice(0, limit * 2)) {
    const l = index.lemmas.get(x.id) as FreqLemma;
    tsv.push(
      [
        x.rank,
        x.id,
        l.key,
        x.score.toFixed(4),
        x.webRank,
        x.subRank,
        x.web.toFixed(1),
        x.sub.toFixed(1),
      ].join('\t'),
    );
  }
  await writeFileAtomic(freqOut(ctx.paths, 'ranks.tsv'), `${tsv.join('\n')}\n`);
  const ms = performance.now() - t0;
  await writeFileAtomic(freqOut(ctx.paths, 'report.md'), renderReport(result, index, limit, ms));
  const top30 = result.scored.slice(0, 30).map((x) => index.lemmas.get(x.id)?.key);
  const summary = {
    ranked: result.rows.length,
    scored: result.scored.length,
    matchedArfShare: Number((result.stats.matchedArf / result.stats.wordTagArf).toFixed(4)),
    top30,
    ms: Math.round(ms),
  };
  await writeFileAtomic(
    freqOut(ctx.paths, 'report.json'),
    stableJson({ ...summary, stats: result.stats, limit }),
  );
  ctx.log(`freq: ${result.rows.length} lemmas ranked; top 10: ${top30.slice(0, 10).join(', ')}`);
  return summary;
}

const SHARE_TOLERANCE = 1e-9;

/**
 * Every lemma's top forms: shares sum to at most 1, and each form is a form of that lemma in
 * forms.jsonl with that tag. Ranks are unique.
 */
export const topFormsCheck: Check = {
  id: 'freq.top-forms',
  description:
    'Top form shares sum to at most 1, each top form is in forms.jsonl with its tag, ranks are unique',
  async run(ctx) {
    const want = new Map<number, { n: number; forms: { form: string; tag: string }[] }>();
    const ranks = new Map<number, number>();
    for await (const { n, row } of ctx.rows('lemmas.jsonl')) {
      if (row.freqRank !== undefined) {
        const other = ranks.get(row.freqRank);
        if (other !== undefined)
          ctx.issue(`lemmas.jsonl:${n}: rank ${row.freqRank} is also held by lemma ${other}`);
        else ranks.set(row.freqRank, row.id);
      }
      if (row.topForms.length === 0) continue;
      const sum = row.topForms.reduce((a, f) => a + f.share, 0);
      if (sum > 1 + SHARE_TOLERANCE)
        ctx.issue(`lemmas.jsonl:${n}: top form shares of "${row.lemma}" sum to ${sum.toFixed(3)}`);
      want.set(row.id, { n, forms: row.topForms.map((f) => ({ form: f.form, tag: f.tag })) });
    }
    if (want.size === 0) return;
    if (!ctx.has('forms.jsonl')) {
      ctx.warn('no forms.jsonl: top forms unchecked');
      return;
    }
    const have = new Map<number, Map<string, string[]>>();
    for await (const { row } of ctx.rows('forms.jsonl')) {
      if (!want.has(row.lemmaId)) continue;
      let m = have.get(row.lemmaId);
      if (!m) {
        m = new Map();
        have.set(row.lemmaId, m);
      }
      m.set(row.form, row.tags.split(' ').filter(Boolean));
    }
    for (const [id, { n, forms }] of want) {
      for (const f of forms) {
        const tags = have.get(id)?.get(f.form);
        if (!tags)
          ctx.issue(`lemmas.jsonl:${n}: top form "${f.form}" of lemma ${id} is not in forms.jsonl`);
        else if (f.tag === '' ? tags.length > 0 : !tags.includes(f.tag))
          ctx.issue(`lemmas.jsonl:${n}: top form "${f.form}" of lemma ${id} has no tag "${f.tag}"`);
      }
    }
  },
};

export const freqStage: Stage = {
  name: 'freq',
  description:
    'Araneum + OpenSubtitles frequencies → ranks and top forms of the most common lemmas',
  sources: [
    `${ARANEUM_SOURCE}/${LEMMA_POS_FILE}`,
    `${ARANEUM_SOURCE}/${WORD_TAG_FILE}`,
    `${SUBTITLE_SOURCE}/${SUBTITLE_FILE}`,
  ],
  codeDir: codeDirOf(import.meta.url),
  options: { limit: { type: 'string' } },
  inputs: (ctx) => Object.values(inputsOf(ctx)),
  outputs: (ctx) =>
    ['lemmas.jsonl', 'ranks.tsv', 'report.md', 'report.json'].map((f) => freqOut(ctx.paths, f)),
  params: (ctx) => ({ limit: limitOf(ctx) }),
  run: runFreq,
  parts: [{ file: 'lemmas.jsonl', path: (p) => freqOut(p, 'lemmas.jsonl'), mode: 'merge' }],
  checks: [topFormsCheck],
};
