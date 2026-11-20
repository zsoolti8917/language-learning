// Stage 13, analysis: the word by word analysis of the library texts (docs/work-packages.md,
// I2). It runs the analyzer of apps/api, as the app runs it on a text a learner pastes, on a
// database that `load` filled, and keeps each result in
// content/generated/library-analysis.jsonl (in git). The `library` stage copies a result
// into library.jsonl, so the app shows a starter text at once instead of analysing it on
// first use.
//
// The analyzer's rules decide most words; the words they leave open go to the route
// `reader.disambiguate`. Lemmas of the texts that the dictionary has no gloss for are asked
// on `reader.gloss`, once for the whole library when every text has its readings, and are
// kept with the other generated glosses (content/generated/glosses.jsonl), from where `dict`
// puts them into senses.jsonl.
//
//   pnpm run pipeline analysis                                the texts without an analysis
//   pnpm run pipeline analysis --pglite <dir> --fill offline  answers written outside the API
//   pnpm run pipeline analysis --pglite <dir> --fill live     asks the model (ANTHROPIC_API_KEY)
//   pnpm run pipeline analysis --pglite <dir> --fill mock     first readings, in the build folder
//   pnpm run pipeline analysis --pglite <dir> --fill dry-run  counts the requests, writes nothing
//   --all        analyse every text again, not only those without a current analysis
//
// A build runs dict, library, validate and load first, then this stage until no request is
// open, then dict (for the new glosses), library, validate and load again.
import { join } from 'node:path';
import {
  type AiGateway,
  createGateway,
  createMockGateway,
  isAiGatewayError,
  promptFor,
  promptMockDefaults,
} from '@app/ai';
import { createPorts } from '@app/api/container';
import type { AnalyzerResult } from '@app/api/modules/analyzer/service';
import { type GlossAnswer, glossesToStore, glossRequest } from '@app/api/modules/lexicon/service';
import { createBackground } from '@app/api/platform/background';
import { systemClock, uuidV7Ids } from '@app/api/platform/clock';
import { LOCAL_DEFAULTS, loadConfig } from '@app/api/platform/config';
import type { DictionaryPort } from '@app/api/ports';
import type { Lemma, ReadingMethod } from '@app/contracts';
import { type Database, lemma as lemmaTable } from '@app/db';
import { existsSync, JsonlWriter, readJsonl, stableJson, writeFileAtomic } from '../../lib/files';
import { codeDirOf, type Stage, type StageContext } from '../../lib/runner';
import {
  answeredByOf,
  FILL_OPTIONS,
  type FillMode,
  fillModeOf,
  maxSpendOf,
  offlineAnswersDir,
  offlineRequestsDir,
} from '../../model/options';
import { createOfflineGateway, gatewayRequest, type OfflineCall } from '../../offline/gateway';
import { type GeneratedGloss, glossesPath, readGlosses } from '../dict';
import { bodyHash, libraryDir } from '../library';
import {
  analysisPath,
  type LibraryAnalysis,
  readAnalyses,
  writeAnalyses,
} from '../library/analysis';
import { type AuthoredText, readAuthoredTexts } from '../library/authored';
import { openDatabase } from '../load';
import { ANALYSIS_ROUTES, answerProblems, DISAMBIGUATE_ROUTE, GLOSS_ROUTE } from './answers';

/** The learner the gateway calls are made for: nobody. No usage row is written. */
export const ANALYSIS_USER_ID = '00000000-0000-7000-8000-000000000000';
/** Lemmas per `reader.gloss` request. */
export const GLOSS_GROUP_SIZE = 40;
const METHODS: readonly ReadingMethod[] = ['single', 'rule', 'model', 'guess'];

const out = (ctx: StageContext, f: string) => join(ctx.paths.build, 'analysis', f);

/** A gateway that names its calls and remembers them. */
export interface TrackedGateway extends AiGateway {
  job(name: string): void;
  readonly calls: readonly OfflineCall[];
}

/** Wraps a gateway so that each structured call is remembered with its job and answer. */
export function trackGateway(inner: AiGateway): TrackedGateway {
  const calls: OfflineCall[] = [];
  let job = 'call';
  return {
    job(name) {
      job = name;
    },
    get calls() {
      return calls;
    },
    async structured(req) {
      const r = gatewayRequest(req as Parameters<typeof gatewayRequest>[0]);
      const call: OfflineCall = { route: r.route, hash: r.hash, job, user: r.user };
      calls.push(call);
      const res = await inner.structured(req);
      call.data = res.data;
      call.model = res.usage.model;
      return res;
    },
    stream: (req) => inner.stream(req),
  };
}

export interface TextOutcome {
  text: AuthoredText;
  result: AnalyzerResult;
  methods: Record<ReadingMethod, number>;
  /** Lemma ids of the text that have no gloss. */
  withoutGloss: number[];
  /** Hashes of the requests of this text that have no answer yet. */
  open: string[];
}

export interface AnalysisOutcome {
  texts: TextOutcome[];
  /** Glosses the run was given for lemmas the dictionary lacks, by lemma id. */
  glosses: Map<number, { glosses: string[]; hash: string; model: string }>;
  /** Hashes of the gloss requests without an answer. */
  openGlosses: string[];
}

const countMethods = (r: AnalyzerResult): Record<ReadingMethod, number> => {
  const m = { single: 0, rule: 0, model: 0, guess: 0 };
  for (const s of r.analysis.sentences) for (const t of s.tokens) if (t.m) m[t.m] += 1;
  return m;
};

/**
 * Analyses the texts on the database, then asks for the glosses their lemmas lack.
 * `known` holds generated glosses the database may not have yet. Glosses are asked only when
 * no text has a guessed word: until then the lemmas are not final.
 */
export async function analyseTexts(opts: {
  database: Database;
  gateway: TrackedGateway;
  texts: readonly AuthoredText[];
  known?: ReadonlyMap<number, string[]>;
}): Promise<AnalysisOutcome> {
  const { database, gateway } = opts;
  const base = {
    config: loadConfig({ ...LOCAL_DEFAULTS }),
    database,
    clock: systemClock,
    ids: uuidV7Ids,
    ai: gateway,
    background: createBackground(),
  };
  const real = createPorts(base);
  // The analyzer reads stored glosses only: missing ones are asked below, for all texts at
  // once, so the answers can be kept in content/generated and not only in this database.
  const dictionary: DictionaryPort = {
    ...real.dictionary,
    ensureGlosses: async (lemmaIds) => {
      const senses = await real.dictionary.getSenses(lemmaIds);
      return new Map(lemmaIds.map((id) => [id, (senses.get(id) ?? []).map((s) => s.glossEn)]));
    },
  };
  const ports = createPorts(base, { dictionary });

  const texts: TextOutcome[] = [];
  for (const text of opts.texts) {
    gateway.job(text.id);
    const before = gateway.calls.length;
    const result = await ports.analyzer.analyzeText(text.body, { userId: ANALYSIS_USER_ID });
    for (const [id, l] of Object.entries(result.analysis.lemmas)) {
      const known = opts.known?.get(Number(id));
      if (l.gloss.length === 0 && known) l.gloss = [...known];
    }
    texts.push({
      text,
      result,
      methods: countMethods(result),
      withoutGloss: Object.entries(result.analysis.lemmas)
        .filter(([, l]) => l.gloss.length === 0)
        .map(([id]) => Number(id)),
      open: gateway.calls
        .slice(before)
        .filter((c) => c.data === undefined)
        .map((c) => c.hash),
    });
  }

  const glosses: AnalysisOutcome['glosses'] = new Map();
  const openGlosses: string[] = [];
  const missing = [...new Set(texts.flatMap((t) => t.withoutGloss))].sort((a, b) => a - b);
  if (missing.length > 0 && texts.every((t) => t.methods.guess === 0)) {
    gateway.job('glosses');
    const lemmas: Lemma[] = [];
    for (const id of missing) {
      const l = await real.morphology.getLemma(id);
      if (l) lemmas.push(l);
    }
    for (let i = 0; i < lemmas.length; i += GLOSS_GROUP_SIZE) {
      const group = lemmas.slice(i, i + GLOSS_GROUP_SIZE);
      const before = gateway.calls.length;
      let answer: GlossAnswer;
      try {
        answer = (await gateway.structured(glossRequest(group, ANALYSIS_USER_ID))).data;
      } catch (e) {
        // No answer (yet): these lemmas stay without a gloss. A used up budget stops the run.
        if (!isAiGatewayError(e) || e.code === 'budget_exceeded') throw e;
        const call = gateway.calls[before];
        if (call) openGlosses.push(call.hash);
        continue;
      }
      const call = gateway.calls[before] as OfflineCall;
      for (const [id, list] of glossesToStore(answer, new Set(group.map((l) => l.id))))
        glosses.set(id, { glosses: list, hash: call.hash, model: call.model ?? 'unknown' });
    }
    for (const t of texts) {
      for (const id of t.withoutGloss) {
        const g = glosses.get(id);
        const l = t.result.analysis.lemmas[String(id)];
        if (g && l) l.gloss = [...g.glosses];
      }
      t.withoutGloss = t.withoutGloss.filter((id) => !glosses.has(id));
    }
  }
  return { texts, glosses, openGlosses };
}

/** The gateway of a fill mode, and what closes it. */
function gatewayOf(
  ctx: StageContext,
  mode: Exclude<FillMode, 'none'>,
): { gateway: TrackedGateway; close(): Promise<void> } {
  if (mode === 'offline' || mode === 'dry-run') {
    const g = createOfflineGateway({
      requestsDir: offlineRequestsDir(ctx.paths, 'analysis'),
      answersDir: offlineAnswersDir(ctx.paths, 'analysis'),
      answeredBy: answeredByOf(ctx),
      check: answerProblems,
      dry: mode === 'dry-run',
    });
    return { gateway: g, close: () => g.close(ANALYSIS_ROUTES) };
  }
  if (mode === 'mock')
    return {
      gateway: trackGateway(createMockGateway({ defaults: promptMockDefaults() })),
      close: async () => undefined,
    };
  // Live: the real gateway. --max-spend is its whole budget; nothing is written to app.ai_call.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('analysis: --fill live needs ANTHROPIC_API_KEY');
  let spentUsd = 0;
  const gateway = createGateway({
    mode: 'anthropic',
    apiKey,
    dailyBudgetUsd: maxSpendOf(ctx),
    spendToday: async () => ({ spentUsd, resetsAt: ctx.now().toISOString() }),
    recordUsage: async (row) => {
      spentUsd += row.costUsd;
    },
  });
  return { gateway: trackGateway(gateway), close: async () => undefined };
}

/** Adds glosses the run was given to content/generated/glosses.jsonl; returns how many. */
async function keepGlosses(ctx: StageContext, glosses: AnalysisOutcome['glosses']) {
  if (glosses.size === 0) return 0;
  const lemmasPath = join(ctx.paths.build, 'morph', 'lemmas.jsonl');
  if (!existsSync(lemmasPath))
    throw new Error(`analysis: ${lemmasPath} does not exist; it names the lemmas of the glosses`);
  const rows = new Map<string, GeneratedGloss>();
  const gpath = glossesPath(ctx);
  for (const g of await readGlosses(gpath)) rows.set(g.key, g);
  let added = 0;
  for await (const l of readJsonl<{ id: number; key: string; lemma: string; pos: string }>(
    lemmasPath,
  )) {
    const g = glosses.get(l.id);
    if (!g) continue;
    rows.set(l.key, {
      key: l.key,
      lemmaId: l.id,
      lemma: l.lemma,
      pos: l.pos,
      glosses: g.glosses,
      source: 'generated',
      route: GLOSS_ROUTE,
      promptVersion: promptFor(GLOSS_ROUTE).version,
      model: g.model,
      requestHash: g.hash,
    });
    added++;
  }
  const w = await JsonlWriter.open(gpath);
  for (const row of [...rows.values()].sort((a, b) => a.lemmaId - b.lemmaId)) await w.write(row);
  await w.close();
  return added;
}

export async function runAnalysis(ctx: StageContext): Promise<Record<string, unknown>> {
  const mode = fillModeOf(ctx);
  const texts = (await readAuthoredTexts(libraryDir(ctx))).sort((a, b) => a.ord - b.ord);
  const apath = analysisPath(ctx);
  const rows = new Map<string, LibraryAnalysis>();
  for (const r of await readAnalyses(apath)) rows.set(r.id, r);
  const current = (t: AuthoredText) => rows.get(t.id)?.bodyHash === bodyHash(t.body);
  const pending = ctx.args.all === true ? texts : texts.filter((t) => !current(t));
  const summary = {
    mode,
    texts: texts.length,
    analysed: texts.filter(current).length,
    pending: pending.map((t) => t.id),
  };
  if (pending.length === 0) {
    ctx.log(`analysis: all ${texts.length} texts have an analysis of their current text`);
    return summary;
  }
  if (mode === 'none') {
    ctx.log(
      `analysis: ${pending.length} texts have no analysis of their current text: ${pending.map((t) => t.id).join(', ')}. Run with --pglite <dir> --fill offline, live or mock on a loaded database.`,
    );
    return summary;
  }

  const database = openDatabase(ctx);
  const { gateway, close } = gatewayOf(ctx, mode);
  let outcome: AnalysisOutcome;
  try {
    const loaded = await database
      .withSystem((tx) => tx.select({ id: lemmaTable.id }).from(lemmaTable).limit(1))
      .catch(() => []);
    if (loaded.length === 0)
      throw new Error('analysis: the database holds no content; run `load` on it first');
    // Generated glosses the database may not hold yet (it was loaded before they were made).
    const known = new Map<number, string[]>();
    if (mode !== 'mock')
      for (const g of await readGlosses(glossesPath(ctx))) known.set(g.lemmaId, g.glosses);
    outcome = await analyseTexts({ database, gateway, texts: pending, known });
  } finally {
    await database.close();
  }
  await close();

  // A text is kept when no word is a guess and, outside a mock run, every lemma has a gloss.
  const by = mode === 'mock' ? 'mock' : mode === 'offline' ? answeredByOf(ctx) : undefined;
  const done: string[] = [];
  const waiting: string[] = [];
  for (const t of outcome.texts) {
    const complete = t.methods.guess === 0 && (mode === 'mock' || t.withoutGloss.length === 0);
    if (!complete || mode === 'dry-run') {
      waiting.push(t.text.id);
      continue;
    }
    const calls = gateway.calls.filter((c) => c.job === t.text.id && c.data !== undefined);
    rows.set(t.text.id, {
      id: t.text.id,
      bodyHash: bodyHash(t.text.body),
      tokenCount: t.result.tokenCount,
      lemmaCounts: Object.fromEntries(
        Object.entries(t.result.lemmaCounts).map(([id, n]) => [String(id), n]),
      ),
      analysis: t.result.analysis,
      methods: t.methods,
      route: DISAMBIGUATE_ROUTE,
      promptVersion: promptFor(DISAMBIGUATE_ROUTE).version,
      model: by ?? calls[0]?.model ?? 'rules',
      requestHashes: [...new Set(calls.map((c) => c.hash))],
      ...(mode === 'mock' ? { mock: true as const } : {}),
    });
    done.push(t.text.id);
  }
  if (done.length > 0) {
    const ids = new Set(texts.map((t) => t.id));
    await writeAnalyses(
      apath,
      [...rows.values()].filter((r) => ids.has(r.id)),
    );
    ctx.log(`analysis: ${done.length} analyses written to ${apath}`);
  }
  const kept = mode === 'mock' || mode === 'dry-run' ? 0 : await keepGlosses(ctx, outcome.glosses);
  if (kept > 0)
    ctx.log(
      `analysis: ${kept} glosses added to ${glossesPath(ctx)}; run dict, library, validate and load again`,
    );

  const open = gateway.calls.filter((c) => c.data === undefined);
  const report = {
    ...summary,
    written: done,
    waiting,
    requests: {
      [DISAMBIGUATE_ROUTE]: gateway.calls.filter((c) => c.route === DISAMBIGUATE_ROUTE).length,
      [GLOSS_ROUTE]: gateway.calls.filter((c) => c.route === GLOSS_ROUTE).length,
      open: open.length,
    },
    glossesKept: kept,
    perText: outcome.texts.map((t) => ({
      id: t.text.id,
      words: t.result.tokenCount,
      lemmas: Object.keys(t.result.lemmaCounts).length,
      ...t.methods,
      withoutGloss: t.withoutGloss.length,
      open: t.open.length,
    })),
  };
  await writeFileAtomic(out(ctx, 'report.json'), stableJson(report));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(report));
  for (const t of report.perText)
    ctx.log(
      `analysis: ${t.id}: ${t.words} words, ${METHODS.map((m) => `${t[m]} ${m}`).join(', ')}, ${t.withoutGloss} lemmas without a gloss, ${t.open} requests open`,
    );
  if (open.length > 0)
    ctx.log(
      mode === 'offline'
        ? `analysis: ${open.length} requests are open in ${offlineRequestsDir(ctx.paths, 'analysis')}; write their answers and run again`
        : `analysis: ${open.length} requests had no answer`,
    );
  return report;
}

function renderReport(r: {
  mode: unknown;
  texts: unknown;
  written: string[];
  waiting: string[];
  requests: Record<string, number>;
  glossesKept: number;
  perText: ({
    id: string;
    words: number;
    lemmas: number;
    withoutGloss: number;
    open: number;
  } & Record<ReadingMethod, number>)[];
}): string {
  return `${[
    '# Library analysis report',
    '',
    `Mode \`${String(r.mode)}\`: ${r.written.length} analyses written, ${r.waiting.length} texts waiting for answers. Requests: ${r.requests[DISAMBIGUATE_ROUTE]} on ${DISAMBIGUATE_ROUTE}, ${r.requests[GLOSS_ROUTE]} on ${GLOSS_ROUTE}, ${r.requests.open} open. Glosses kept: ${r.glossesKept}.`,
    '',
    'How each word got its reading: `single` (one reading in the data), `rule` (grammar rules), `model` (the route), `guess` (no answer yet: the most frequent reading).',
    '',
    '| Id | Words | Lemmas | Single | Rule | Model | Guess | Without a gloss | Open requests |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...r.perText.map(
      (t) =>
        `| ${t.id} | ${t.words} | ${t.lemmas} | ${t.single} | ${t.rule} | ${t.model} | ${t.guess} | ${t.withoutGloss} | ${t.open} |`,
    ),
  ].join('\n')}\n`;
}

export const analysisStage: Stage = {
  name: 'analysis',
  description:
    'Analyses the library texts with the analyzer of apps/api on a loaded database (reader.disambiguate, reader.gloss)',
  codeDir: codeDirOf(import.meta.url),
  alwaysRun: true,
  options: {
    ...FILL_OPTIONS,
    pglite: { type: 'string' },
    analysis: { type: 'string' },
    glosses: { type: 'string' },
    all: { type: 'boolean' },
  },
  inputs: () => [],
  outputs: () => [],
  run: runAnalysis,
};
