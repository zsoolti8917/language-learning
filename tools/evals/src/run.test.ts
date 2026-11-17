// The harness end to end on the fixture treebank and the mini dataset, with the mock model.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockGateway } from '@app/ai';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDatasets, readDatasets, writeDatasets } from './datasets/build';
import { renderComparison, renderMarkdown } from './report';
import { runEval, writeRun } from './run';
import { fixtureSentences, miniLexicon } from './testing/fixtures';

const lexicon = miniLexicon();
const datasets = buildDatasets(fixtureSentences(), lexicon, {
  seed: 3,
  sizes: { correct: 4, injected: 5, analyzer: 5 },
});
const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'evals-run-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const base = {
  datasets,
  lexicon,
  suites: ['tutor', 'analyzer'] as const,
  replies: true,
  concurrency: 2,
  perText: 2,
};

describe('a mock run', () => {
  it('scores a perfect mock model at 100 % and meets the targets', async () => {
    const { report, tutor } = await runEval({ ...base, mode: 'mock', cacheDir: temp() });
    expect(report.datasets).toMatchObject({ correct: 4, injected: 5, analyzer: 5 });
    const t = report.tutor;
    expect(t?.recall).toMatchObject({ n: 5, of: 5, value: 1 });
    expect(t?.precision.value).toBe(1);
    expect(t?.exactOfFound.value).toBe(1);
    expect(t?.falseCorrections).toMatchObject({ n: 0, of: 4 });
    expect(t?.replies.checked).toBe(9);
    expect(t?.replies.clean.value).toBe(1);
    expect(tutor.filter((r) => r.kind === 'injected').every((r) => r.found && r.exact)).toBe(true);
    // Split by case and trigger: every injected case is in exactly one row.
    expect(t?.byCase.reduce((n, r) => n + r.recall.of, 0)).toBe(5);
    expect(t?.byTrigger.reduce((n, r) => n + r.recall.of, 0)).toBe(5);
    const a = report.analyzer;
    expect(a?.sentences).toBe(5);
    expect(a?.unaligned).toBe(0);
    expect(a?.caseAccuracy.value).toBe(1);
    expect(a?.byMethod.map((m) => m.method)).toEqual(expect.arrayContaining(['single', 'rule']));
    expect(report.targets.map((x) => x.met)).toEqual([true, true, true]);
    expect(report.promptVersions).toEqual({
      'tutor.analyze': 1,
      'tutor.reply': 1,
      'reader.disambiguate': 1,
    });
    // Calls per route, with their usage, in the cost table.
    const routes = report.costs.map((c) => c.route);
    expect(routes).toEqual(['reader.disambiguate', 'tutor.analyze', 'tutor.reply']);
    expect(report.costs.find((c) => c.route === 'tutor.analyze')?.calls).toBe(9);
    expect(renderMarkdown(report)).toContain(
      'Injected errors found | at least 85 % | 100.0 % (5/5) | yes',
    );
  });

  it('puts planted mistakes in the right metrics, and verification removes false reports', async () => {
    const { report } = await runEval({
      ...base,
      mode: 'mock',
      cacheDir: temp(),
      oracle: { missRate: 0.5, falseRate: 1, wrongPickRate: 1 },
    });
    const t = report.tutor;
    // Every correct sentence got a false report; verification shows none of them.
    expect(t?.falseCorrectionsBeforeVerify).toMatchObject({ n: 4, of: 4 });
    expect(t?.falseCorrections).toMatchObject({ n: 0, of: 4 });
    expect(t?.verification.falseReports).toBe(4);
    expect(t?.verification.falseRemoved.value).toBe(1);
    expect(t?.recall.n).toBeLessThan(5);
    expect(t?.recall.n).toBe(t?.recallBeforeVerify.n);
  });

  it('runs the analyzer through the model only for open words, and the model picks count', async () => {
    const { report, log } = await runEval({
      ...base,
      suites: ['analyzer'],
      mode: 'mock',
      cacheDir: temp(),
      oracle: { wrongPickRate: 1 },
    });
    const model = report.analyzer?.byMethod.find((m) => m.method === 'model');
    expect(log.every((c) => c.route === 'reader.disambiguate')).toBe(true);
    if (model) expect(model.case.value).toBeLessThan(1);
  });
});

describe('repeat from cached answers', () => {
  it('gives the same report from the cache with no model call', async () => {
    const cacheDir = temp();
    const first = await runEval({
      ...base,
      mode: 'mock',
      cacheDir,
      oracle: { missRate: 0.3, falseRate: 0.5 },
    });
    const again = await runEval({ ...base, mode: 'replay', cacheDir });
    expect(again.log.every((c) => c.cached)).toBe(true);
    expect(again.report.tutor).toEqual(first.report.tutor);
    expect(again.report.analyzer).toEqual(first.report.analyzer);
    expect(again.report.costs.map((c) => [c.route, c.calls, c.inputTokens, c.costUsd])).toEqual(
      first.report.costs.map((c) => [c.route, c.calls, c.inputTokens, c.costUsd]),
    );
  });

  it('answers through the live gateway once, then from the cache', async () => {
    const cacheDir = temp();
    const live = createMockGateway({});
    live.respond('tutor.analyze', () => ({
      data: { errors: [], retries: [], goalUpdates: [], meaningOk: true },
      usage: { costUsd: 0.01, latencyMs: 1200 },
    }));
    live.respond('tutor.reply', () => ({
      text: 'Dobre. A potom?',
      usage: { costUsd: 0.002, latencyMs: 800 },
    }));
    const opts = { ...base, suites: ['tutor'] as const, mode: 'live' as const, cacheDir, live };
    const first = await runEval(opts);
    expect(live.calls).toHaveLength(18);
    const cost = first.report.costs.find((c) => c.route === 'tutor.analyze');
    expect(cost).toMatchObject({ calls: 9, costUsd: 0.09, latencyMeanMs: 1200 });
    expect(first.report.tutor?.recall.n).toBe(0);
    await runEval(opts);
    expect(live.calls).toHaveLength(18);
  });
});

describe('files', () => {
  it('writes and reads the datasets, and writes the report', async () => {
    const dir = temp();
    writeDatasets(dir, datasets);
    expect(readDatasets(dir)).toEqual(datasets);
    const r = await runEval({
      ...base,
      datasets: readDatasets(dir),
      mode: 'dry-run',
      cacheDir: temp(),
    });
    expect(r.report.mode).toBe('dry-run');
    expect(r.log.every((c) => c.estimated)).toBe(true);
    expect(r.report.totals.costUsd).toBeGreaterThan(0);
    const out = join(dir, 'run');
    writeRun(out, r);
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('Dry run: no request was sent');
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).mode).toBe('dry-run');
    expect(renderComparison(r.report, r.report)).toContain('`tutor.reply` model');
  });
});
