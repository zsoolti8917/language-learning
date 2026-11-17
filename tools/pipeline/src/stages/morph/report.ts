// The quality report of the morph stage: counts per part of speech, tags that failed to
// parse, the spread of patterns, 50 random nouns with their pattern, the nouns without a
// pattern or flag, the measured size of the forms table, and the mini dataset comparison.
import type { MorphResult, NounNote } from './build';
import { type FormDiff, sample } from './compare';
import type { FormsTableSize } from './measure';

export interface MorphReport {
  input: { file: string; sha256: string };
  stats: Omit<MorphResult['stats'], 'newIds'>;
  totals: { lemmas: number; forms: number };
  nouns: {
    total: number;
    withPattern: number;
    irregular: number;
    covered: number;
    coveredShare: number;
    /** Nouns with neither a pattern nor the irregular flag, with the reason. */
    uncovered: { id: number; lemma: string; gender: string; reason: string }[];
    uncoveredByReason: Record<string, number>;
    /** Irregular nouns whose pattern failed the test, with the slots that failed (first 100). */
    failedTests: { id: number; lemma: string; pattern: string; slots: string[] }[];
    random: {
      id: number;
      lemma: string;
      gender: string;
      pattern: string | null;
      irregular: boolean;
    }[];
  };
  formsTable: FormsTableSize | null;
  mini: {
    compared: boolean;
    lemmaKeyMismatches: { id: number; mini: string; built: string | null }[];
    formDiffs: FormDiff[];
  };
  /** Ids added by this run are left out: the report of a rerun must not differ. */
  registry: { size: number; retired: number };
}

export const NOUN_COVERAGE_TARGET = 0.95;

export function nounSummary(nouns: readonly NounNote[]): MorphReport['nouns'] {
  const live = nouns;
  const withPattern = live.filter((n) => n.result.pattern).length;
  const irregular = live.filter((n) => n.result.irregular).length;
  const uncoveredNotes = live.filter((n) => !n.result.pattern && !n.result.irregular);
  const uncovered = uncoveredNotes.map((n) => ({
    id: n.id,
    lemma: n.lemma,
    gender: n.gender,
    reason: 'reason' in n.result ? n.result.reason : 'unknown',
  }));
  const uncoveredByReason: Record<string, number> = {};
  for (const u of uncovered) uncoveredByReason[u.reason] = (uncoveredByReason[u.reason] ?? 0) + 1;
  const covered = live.length - uncovered.length;
  const failedTests = live
    .filter((n) => n.result.pattern && n.result.irregular && 'failed' in n.result)
    .slice(0, 100)
    .map((n) => ({
      id: n.id,
      lemma: n.lemma,
      pattern: n.result.pattern as string,
      slots: ('failed' in n.result && n.result.failed) || [],
    }));
  // Proper names are left out of the random sample: the report is for checking common nouns.
  const common = live.filter((n) => !/^\p{Lu}/u.test(n.lemma));
  const random = sample(common, 50, 42).map((n) => ({
    id: n.id,
    lemma: n.lemma,
    gender: n.gender,
    pattern: n.result.pattern ?? null,
    irregular: n.result.irregular,
  }));
  return {
    total: live.length,
    withPattern,
    irregular,
    covered,
    coveredShare: live.length > 0 ? covered / live.length : 1,
    uncovered,
    uncoveredByReason,
    failedTests,
    random,
  };
}

const fmt = (n: number) => n.toLocaleString('en-US');
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function renderReport(r: MorphReport): string {
  const out: string[] = [];
  const p = (s = '') => out.push(s);
  p('# Morphology quality report');
  p();
  p(`Source: \`${r.input.file}\`, sha256 \`${r.input.sha256}\`.`);
  p();
  p('## Totals');
  p();
  p('| | Count |');
  p('|---|---:|');
  p(`| Lines read | ${fmt(r.stats.lines)} |`);
  p(`| Entries kept | ${fmt(r.stats.entries)} |`);
  p(`| Dropped: marked as errors (\`*\`, \`:q\`) | ${fmt(r.stats.dropped.misspelling)} |`);
  p(`| Dropped: comparative and superlative | ${fmt(r.stats.dropped.degree)} |`);
  p(`| Dropped: tag failed to parse | ${fmt(r.stats.dropped.unparsed)} |`);
  p(`| Malformed lines | ${fmt(r.stats.malformedLines)} |`);
  p(`| Lemmas | ${fmt(r.totals.lemmas)} |`);
  p(`| Forms (rows of forms.jsonl) | ${fmt(r.totals.forms)} |`);
  p(`| Registry size / retired lemmas | ${fmt(r.registry.size)} / ${fmt(r.registry.retired)} |`);
  p();
  p('## Parts of speech');
  p();
  p('| Pos | Lemmas | Forms | Irregular |');
  p('|---|---:|---:|---:|');
  for (const pos of Object.keys(r.stats.lemmasByPos).sort())
    p(
      `| ${pos} | ${fmt(r.stats.lemmasByPos[pos] ?? 0)} | ${fmt(r.stats.formsByPos[pos] ?? 0)} | ${fmt(r.stats.irregularByPos[pos] ?? 0)} |`,
    );
  p();
  p('## Tags that failed to parse');
  p();
  const bad = Object.entries(r.stats.unparsedTags).sort((a, b) => b[1] - a[1]);
  if (bad.length === 0) p('None.');
  else {
    p('| Tag | Entries |');
    p('|---|---:|');
    for (const [t, c] of bad) p(`| \`${t}\` | ${fmt(c)} |`);
  }
  p();
  p('## Patterns');
  p();
  p('| Pattern | Lemmas |');
  p('|---|---:|');
  for (const [k, v] of Object.entries(r.stats.patterns).sort((a, b) => b[1] - a[1]))
    p(`| ${k} | ${fmt(v)} |`);
  p();
  const n = r.nouns;
  p('## Nouns');
  p();
  p(
    `${fmt(n.total)} nouns: ${fmt(n.withPattern)} with a pattern, ${fmt(n.irregular)} flagged irregular, ${fmt(n.covered)} with a pattern or the flag (${(n.coveredShare * 100).toFixed(2)} %, target ${NOUN_COVERAGE_TARGET * 100} %).`,
  );
  p();
  p('### 50 random nouns');
  p();
  p('| Id | Noun | Gender | Pattern | Irregular |');
  p('|---:|---|---|---|---|');
  for (const x of n.random)
    p(`| ${x.id} | ${x.lemma} | ${x.gender} | ${x.pattern ?? ''} | ${x.irregular ? 'yes' : ''} |`);
  p();
  p('### Nouns with a pattern that failed its test (irregular, first 100)');
  p();
  p(
    n.failedTests.length === 0
      ? 'None.'
      : n.failedTests.map((f) => `${f.lemma} (${f.pattern}: ${f.slots.join(', ')})`).join('; '),
  );
  p();
  p(`### Nouns without a pattern or the irregular flag (${fmt(n.uncovered.length)})`);
  p();
  p(
    Object.entries(n.uncoveredByReason)
      .map(([k, v]) => `${k}: ${fmt(v)}`)
      .join(', ') || 'None.',
  );
  p();
  if (n.uncovered.length > 0) {
    const byReason = new Map<string, string[]>();
    for (const u of n.uncovered)
      byReason.set(u.reason, [...(byReason.get(u.reason) ?? []), `${u.lemma} (${u.id})`]);
    for (const [reason, list] of byReason) {
      p(`**${reason}:** ${list.join(', ')}`);
      p();
    }
  }
  p('## Size of the forms table');
  p();
  const s = r.formsTable;
  if (!s) p('Not measured (`--measure off`).');
  else {
    p(
      `Measured in PGlite with the real migrations, ${s.method === 'full' ? 'all rows' : `a seeded sample of ${fmt(s.measuredRows)} rows, scaled up`}.`,
    );
    p();
    p('| | Value |');
    p('|---|---:|');
    p(`| Rows | ${fmt(s.rows)} |`);
    p(`| Rows measured | ${fmt(s.measuredRows)} |`);
    p(`| Table (measured) | ${mb(s.tableBytes)} |`);
    p(`| Indexes (measured) | ${mb(s.indexBytes)} |`);
    p(`| Total (measured) | ${mb(s.totalBytes)} |`);
    p(`| Bytes per row, indexes included | ${s.bytesPerRow} |`);
    p(`| Whole table, indexes included | ${mb(s.estimatedBytes)} |`);
  }
  p();
  p('## Mini dataset comparison');
  p();
  if (!r.mini.compared) p('Not compared.');
  else {
    p(
      r.mini.lemmaKeyMismatches.length === 0
        ? 'Every mini lemma id has the same key in the registry.'
        : `Key mismatches: ${r.mini.lemmaKeyMismatches.map((m) => `${m.id} ${m.mini} → ${m.built ?? 'missing'}`).join('; ')}`,
    );
    p();
    if (r.mini.formDiffs.length === 0)
      p('Every form and tag of the mini dataset matches the built data.');
    else {
      p('| Lemma | Form | Mini tags | Built tags |');
      p('|---:|---|---|---|');
      for (const d of r.mini.formDiffs)
        p(
          `| ${d.lemmaId} | ${d.form} | ${d.expected ?? '(missing)'} | ${d.actual ?? '(missing)'} |`,
        );
    }
  }
  p();
  return out.join('\n');
}
