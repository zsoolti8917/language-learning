// The vocabulary of an assembled content set, for the checks of validate: the lemmas with
// their ranks, and the forms of the words the library texts and the scenarios use. Built once
// per validation run and shared by the library and scenarios checks, because reading the
// forms of a full set takes a few seconds.
import type { CheckContext } from '../../lib/validate';
import { buildFormIndex, type FormIndex, type LemmaInfo } from './vocab';

export interface SetVocabulary {
  lemmas: Map<number, LemmaInfo>;
  index: FormIndex;
}

/** The Slovak text of a scenario row: what the learner reads in it. */
export function scenarioSlovak(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ['titleSk', 'settingSk', 'openingSk'])
    if (typeof row[k] === 'string') out.push(row[k] as string);
  if (Array.isArray(row.vocabHint))
    for (const h of row.vocabHint as { sk?: unknown }[])
      if (typeof h?.sk === 'string') out.push(h.sk);
  return out;
}

const cache = new WeakMap<CheckContext, Promise<SetVocabulary>>();

export function setVocabulary(ctx: CheckContext): Promise<SetVocabulary> {
  let v = cache.get(ctx);
  if (!v) {
    v = build(ctx);
    cache.set(ctx, v);
  }
  return v;
}

async function build(ctx: CheckContext): Promise<SetVocabulary> {
  const texts: string[] = [];
  for await (const { row } of ctx.raw('library.jsonl'))
    if (typeof row.body === 'string') texts.push(row.body);
  for await (const { row } of ctx.raw('scenarios.jsonl')) texts.push(...scenarioSlovak(row));
  const lemmas = new Map<number, LemmaInfo>();
  for await (const { row } of ctx.raw('lemmas.jsonl')) {
    const flags = (row.flags ?? {}) as { proper?: boolean; retired?: boolean };
    if (typeof row.id !== 'number' || flags.retired) continue;
    lemmas.set(row.id, {
      lemma: String(row.lemma),
      ...(typeof row.freqRank === 'number' ? { rank: row.freqRank } : {}),
      proper: flags.proper === true,
    });
  }
  async function* forms() {
    for await (const { row } of ctx.raw('forms.jsonl'))
      if (typeof row.lemmaId === 'number' && typeof row.form === 'string')
        yield {
          lemmaId: row.lemmaId,
          form: row.form,
          ...(typeof row.tags === 'string' ? { tags: row.tags } : {}),
        };
  }
  return { lemmas, index: await buildFormIndex(texts, forms()) };
}
