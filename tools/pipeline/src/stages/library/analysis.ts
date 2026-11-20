// The analyses of the library texts as they are kept: one row per text in
// content/generated/library-analysis.jsonl (in git), with the analyzer's result, the hash of
// the body it was made for and where its open words were decided. The `analysis` stage
// writes the rows (it needs a loaded database and the analyzer of apps/api); the `library`
// stage only copies a row into library.jsonl when it still fits the text, so a rebuild needs
// no database and no model call.
import { join } from 'node:path';
import type { ReadingMethod, TextAnalysis } from '@app/contracts';
import { existsSync, JsonlWriter, readJsonl } from '../../lib/files';
import { resolveArg, type StageContext } from '../../lib/runner';
import { fillModeOf } from '../../model/options';

/** One analysed text in content/generated/library-analysis.jsonl. */
export interface LibraryAnalysis {
  id: string;
  /** sha256 of the body that was analysed: an edited text needs a new analysis. */
  bodyHash: string;
  /** Word tokens of the text. */
  tokenCount: number;
  /** { lemmaId: count } */
  lemmaCounts: Record<string, number>;
  analysis: TextAnalysis;
  /** Words by how their reading was chosen. */
  methods: Record<ReadingMethod, number>;
  route: string;
  promptVersion: number;
  /** Who chose the readings the rules left open: the model, or the writer of an offline fill. */
  model: string;
  /** The model requests behind the row. */
  requestHashes: string[];
  /** Written by --fill mock: first readings, never a real analysis. */
  mock?: true;
}

const base = () => process.env.INIT_CWD ?? process.cwd();

/** content/generated/library-analysis.jsonl; mock rows go to the build folder. */
export function analysisPath(ctx: StageContext): string {
  const custom = resolveArg(ctx.args.analysis, base());
  if (custom) return custom;
  if (fillModeOf(ctx) === 'mock') return join(ctx.paths.build, 'analysis', 'analysis.mock.jsonl');
  return join(ctx.paths.content, 'generated', 'library-analysis.jsonl');
}

export async function readAnalyses(path: string): Promise<LibraryAnalysis[]> {
  const rows: LibraryAnalysis[] = [];
  if (!existsSync(path)) return rows;
  for await (const r of readJsonl<LibraryAnalysis>(path)) rows.push(r);
  return rows;
}

export async function writeAnalyses(
  path: string,
  rows: Iterable<LibraryAnalysis>,
): Promise<number> {
  const w = await JsonlWriter.open(path);
  for (const r of [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))) await w.write(r);
  await w.close();
  return w.count;
}
