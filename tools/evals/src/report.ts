// The report of a run: one JSON file (kept for comparisons) and one Markdown file (read by
// people, and copied into docs/evals.md after a live run).
import type { AiRoute } from '@app/contracts';
import {
  type AnalyzerMetrics,
  type Rate,
  type RouteCost,
  TARGETS,
  type TutorMetrics,
} from './metrics';

export type RunMode = 'mock' | 'dry-run' | 'live' | 'replay';

export interface TargetResult {
  name: string;
  target: string;
  value: Rate | null;
  /** null when the run did not measure it. */
  met: boolean | null;
}

export interface EvalReport {
  mode: RunMode;
  /** True when the numbers come from the mock model and say nothing about the real one. */
  mockModel: boolean;
  datasets: {
    correct: number;
    injected: number;
    analyzer: number;
    seed: number;
    morphology: string;
  };
  promptVersions: Partial<Record<AiRoute, number>>;
  models: Partial<Record<AiRoute, string>>;
  tutor?: TutorMetrics | undefined;
  analyzer?: AnalyzerMetrics | undefined;
  costs: RouteCost[];
  totals: { calls: number; cached: number; costUsd: number; worstUsd: number };
  targets: TargetResult[];
}

export function targetsOf(
  tutor: TutorMetrics | undefined,
  analyzer: AnalyzerMetrics | undefined,
): TargetResult[] {
  const check = (r: Rate | undefined, ok: (v: number) => boolean) =>
    r === undefined || r.value === null ? null : ok(r.value);
  return [
    {
      name: 'False corrections on correct sentences, after verification',
      target: `at most ${TARGETS.falseCorrections * 100} %`,
      value: tutor?.falseCorrections ?? null,
      met: check(tutor?.falseCorrections, (v) => v <= TARGETS.falseCorrections),
    },
    {
      name: 'Injected errors found',
      target: `at least ${TARGETS.recall * 100} %`,
      value: tutor?.recall ?? null,
      met: check(tutor?.recall, (v) => v >= TARGETS.recall),
    },
    {
      name: 'Analyzer case accuracy (words the data knows)',
      target: `at least ${TARGETS.caseAccuracy * 100} %`,
      value: analyzer?.caseAccuracy ?? null,
      met: check(analyzer?.caseAccuracy, (v) => v >= TARGETS.caseAccuracy),
    },
  ];
}

export function pct(r: Rate | null | undefined): string {
  if (!r || r.value === null) return `n/a (0/${r?.of ?? 0})`;
  return `${(r.value * 100).toFixed(1)} % (${r.n}/${r.of})`;
}

const usd = (n: number | null) => (n === null ? 'n/a' : `$${n.toFixed(n < 0.01 && n > 0 ? 5 : 2)}`);
const ms = (n: number | null) => (n === null ? 'n/a' : `${(n / 1000).toFixed(1)} s`);

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

export function renderMarkdown(r: EvalReport): string {
  const out: string[] = [];
  out.push(`# Eval run (${r.mode})`);
  out.push('');
  if (r.mockModel)
    out.push(
      '> The answers come from the mock model (the oracle in `tools/evals/src/oracle.ts`). These numbers check the harness; they say nothing about Claude.',
      '',
    );
  if (r.mode === 'dry-run')
    out.push(
      '> Dry run: no request was sent. Costs are estimates from request sizes and expected output (see `EXPECTED_OUTPUT` in `tools/evals/src/gateway.ts`).',
      '',
    );
  out.push(
    `Datasets: ${r.datasets.correct} correct sentences, ${r.datasets.injected} with an injected case error, ${r.datasets.analyzer} analyzer sentences (seed ${r.datasets.seed}). Morphology: ${r.datasets.morphology}.`,
    '',
  );
  out.push('Prompt versions and models:', '');
  out.push(
    table(
      ['Route', 'Prompt version', 'Model'],
      (Object.keys(r.promptVersions) as AiRoute[]).map((route) => [
        `\`${route}\``,
        `v${r.promptVersions[route]}`,
        r.models[route] ?? 'claude-opus-5-5',
      ]),
    ),
    '',
  );
  out.push('## Targets', '');
  out.push(
    table(
      ['Metric', 'Target', 'Value', 'Met'],
      r.targets.map((t) => [
        t.name,
        t.target,
        pct(t.value),
        t.met === null ? 'not measured' : t.met ? 'yes' : 'no',
      ]),
    ),
    '',
  );

  const t = r.tutor;
  if (t) {
    out.push('## Tutor', '');
    out.push(
      `${t.cases.injected} injected and ${t.cases.correct} correct sentences; ${t.cases.failed} stopped by a model error.`,
      '',
    );
    out.push(
      table(
        ['Metric', 'Before verification', 'After verification (shown)'],
        [
          ['Recall: injected errors found', pct(t.recallBeforeVerify), pct(t.recall)],
          ['Precision of case errors', pct(t.precisionBeforeVerify), pct(t.precision)],
          [
            'False corrections: correct sentences with a case error',
            pct(t.falseCorrectionsBeforeVerify),
            pct(t.falseCorrections),
          ],
          ['Exact expected form, of found errors', '', pct(t.exactOfFound)],
          ['Exact expected form, of all injected errors', '', pct(t.exactOfAll)],
        ],
      ),
      '',
    );
    out.push('### Verification step', '');
    out.push(
      `False reports (case errors that are not the injected one): ${t.verification.falseReports}. Removed by verification: ${pct(t.verification.falseRemoved)}. True reports lost: ${pct(t.verification.trueLost)}.`,
      '',
    );
    const reasons = Object.entries(t.verification.reasons).sort((a, b) => b[1] - a[1]);
    if (reasons.length > 0)
      out.push(
        table(
          ['Reason removed or unverified', 'Errors'],
          reasons.map(([k, n]) => [k, String(n)]),
        ),
        '',
      );
    out.push('### By case (the case the sentence needs)', '');
    out.push(
      table(
        ['Case', 'Recall', 'Exact form of found'],
        t.byCase.map((s) => [s.key, pct(s.recall), pct(s.exact)]),
      ),
      '',
    );
    out.push('### By kind of trigger', '');
    out.push(
      table(
        ['Trigger', 'Recall', 'Exact form of found'],
        t.byTrigger.map((s) => [s.key, pct(s.recall), pct(s.exact)]),
      ),
      '',
    );
    const fc = Object.entries(t.falseByCase);
    if (fc.length > 0) {
      out.push('### False corrections on correct sentences', '');
      out.push(
        table(
          ['Claimed case', 'Errors'],
          fc.map(([k, n]) => [k, String(n)]),
        ),
        '',
        table(
          ['Error type', 'Errors'],
          Object.entries(t.falseByType).map(([k, n]) => [k, String(n)]),
        ),
        '',
      );
    }
    out.push('### Rule checks on replies', '');
    out.push(
      table(
        ['Check', 'Replies'],
        [
          ['No issue', pct(t.replies.clean)],
          ['Longer than 60 words', pct(t.replies.tooLong)],
          ['Prompts an error without a question', pct(t.replies.noQuestion)],
          ['Names a form that was not verified', pct(t.replies.leaked)],
          ['Markdown', pct(t.replies.markdown)],
          ['Empty', pct(t.replies.empty)],
        ],
      ),
      '',
    );
  }

  const a = r.analyzer;
  if (a) {
    out.push('## Analyzer', '');
    out.push(
      `${a.sentences} sentences, ${a.words} words (${a.unaligned} not aligned with the analyzer's tokens).`,
      '',
    );
    out.push(
      table(
        ['Metric', 'Value'],
        [
          ['Words the morphology data knows', pct(a.known)],
          ['Lemma accuracy (known words)', pct(a.lemmaAccuracy)],
          ['Case accuracy (known words)', pct(a.caseAccuracy)],
          ['Case accuracy (all words, unknown ones wrong)', pct(a.caseAccuracyAll)],
        ],
      ),
      '',
    );
    out.push('### By how the reading was chosen', '');
    out.push(
      table(
        ['Method', 'Words', 'Lemma', 'Case'],
        a.byMethod.map((m) => [m.method, String(m.words), pct(m.lemma), pct(m.case)]),
      ),
      '',
    );
    out.push('### Case accuracy by gold case', '');
    out.push(
      table(
        ['Case', 'Accuracy'],
        a.byCase.map((c) => [c.key, pct(c.case)]),
      ),
      '',
    );
    if (a.confusions.length > 0)
      out.push(
        '### Most frequent case confusions',
        '',
        table(
          ['Gold', 'Chosen', 'Words'],
          a.confusions.map((c) => [c.gold, c.chosen, String(c.n)]),
        ),
        '',
      );
  }

  out.push('## Cost and delay per route', '');
  out.push(
    table(
      [
        'Route',
        'Model',
        'Calls',
        'Cached',
        'Input tok',
        'Output tok',
        'Cache read tok',
        'Cost',
        'Per call',
        'Mean delay',
        'p95 delay',
      ],
      r.costs.map((c) => [
        `\`${c.route}\``,
        c.model,
        String(c.calls),
        String(c.cached),
        String(c.inputTokens),
        String(c.outputTokens),
        String(c.cacheReadTokens),
        usd(c.costUsd),
        usd(c.costPerCallUsd),
        ms(c.latencyMeanMs),
        ms(c.latencyP95Ms),
      ]),
    ),
    '',
  );
  out.push(
    `Total: ${r.totals.calls} calls, ${r.totals.cached} from the cache, ${usd(r.totals.costUsd)}` +
      (r.mode === 'dry-run'
        ? ` (at most ${usd(r.totals.worstUsd)} if every call used its whole token limit).`
        : '.'),
    '',
  );
  return out.join('\n');
}

/** Side by side: the same datasets with two model settings, for the cheaper model question. */
export function renderComparison(a: EvalReport, b: EvalReport): string {
  const routes: AiRoute[] = ['tutor.reply', 'reader.disambiguate'];
  const cost = (r: EvalReport, route: AiRoute) => r.costs.find((c) => c.route === route);
  const rows: string[][] = [];
  for (const route of routes) {
    const ca = cost(a, route);
    const cb = cost(b, route);
    rows.push([
      `\`${route}\` model`,
      a.models[route] ?? 'claude-opus-5-5',
      b.models[route] ?? 'claude-opus-5-5',
    ]);
    rows.push([
      `\`${route}\` cost per call`,
      usd(ca?.costPerCallUsd ?? null),
      usd(cb?.costPerCallUsd ?? null),
    ]);
    rows.push([
      `\`${route}\` mean delay`,
      ms(ca?.latencyMeanMs ?? null),
      ms(cb?.latencyMeanMs ?? null),
    ]);
  }
  rows.push(['Replies without issue', pct(a.tutor?.replies.clean), pct(b.tutor?.replies.clean)]);
  rows.push([
    'Replies naming an unverified form',
    pct(a.tutor?.replies.leaked),
    pct(b.tutor?.replies.leaked),
  ]);
  rows.push([
    'Replies prompting without a question',
    pct(a.tutor?.replies.noQuestion),
    pct(b.tutor?.replies.noQuestion),
  ]);
  const modelRow = (r: EvalReport) => r.analyzer?.byMethod.find((m) => m.method === 'model');
  rows.push([
    'Analyzer case accuracy',
    pct(a.analyzer?.caseAccuracy),
    pct(b.analyzer?.caseAccuracy),
  ]);
  rows.push([
    'Analyzer case accuracy, words the model chose',
    pct(modelRow(a)?.case),
    pct(modelRow(b)?.case),
  ]);
  rows.push([
    'Analyzer lemma accuracy',
    pct(a.analyzer?.lemmaAccuracy),
    pct(b.analyzer?.lemmaAccuracy),
  ]);
  return [
    '# Model comparison',
    '',
    table(['', 'Run A', 'Run B'], rows),
    '',
    'The choice of model stays with the owner of the app.',
    '',
  ].join('\n');
}
