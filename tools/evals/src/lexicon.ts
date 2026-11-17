// The morphology data in memory, for the evals. It serves:
// - the `MorphologyPort` the tutor's verification step and the analyzer call, built from the
//   lexicon module's own pure functions (`toCandidate`, `orderCandidates`, `verifyCandidate`,
//   `toLemma`, `toParadigm`), so lookups order and filter exactly as the real port does;
// - the lemma facts and trigger list the analyzer reads from `ling` in production;
// - the paradigms the error injection needs.
//
// Sources: a content folder (the mini dataset in tests), or the pipeline's build output
// (`content/build/morph`, plus `content/build/freq` ranks when present) for real runs. No
// database is needed, so an eval run starts in seconds instead of loading 1 M forms into PGlite.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { LemmaFacts, TriggerFacts } from '@app/api/modules/analyzer/repo';
import type { FormLemmaRow, LemmaRow } from '@app/api/modules/lexicon/repo';
import {
  orderCandidates,
  toCandidate,
  toLemma,
  toParadigm,
  verifyCandidate,
} from '@app/api/modules/lexicon/service';
import type { TriggerInfo } from '@app/api/modules/tutor/pipeline';
import type { DictionaryPort, MorphologyPort } from '@app/api/ports';
import type {
  Case,
  FormCandidate,
  Gender,
  LemmaFlags,
  Pos,
  TopForm,
  TriggerKind,
} from '@app/contracts';
import { foldAscii } from '@app/contracts';

export interface LexLemma {
  id: number;
  key: string;
  lemma: string;
  pos: Pos;
  gender?: Gender | undefined;
  pattern?: string | undefined;
  aspect?: string | undefined;
  freqRank?: number | undefined;
  topForms?: TopForm[] | undefined;
  flags?: (LemmaFlags & { cases?: Case[] }) | undefined;
}

export interface LexForm {
  lemmaId: number;
  form: string;
  tags: string;
}

export interface LexTrigger {
  id: string;
  kind: TriggerKind;
  lemma: string;
  lemmaId?: number | undefined;
  case: Case;
  meaningEn?: string | undefined;
}

export interface LexiconSource {
  lemmas: LexLemma[];
  forms: LexForm[];
  triggers: LexTrigger[];
  /** Where the data came from, for the report. */
  label: string;
}

/** The last two parts of a path, so reports name no machine's folders. */
function shortName(dir: string): string {
  return `${basename(dirname(dir))}/${basename(dir)}`;
}

function readJsonl<T>(path: string): T[] {
  const out: T[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() !== '') out.push(JSON.parse(line) as T);
  }
  return out;
}

/** A content folder with `lemmas.jsonl`, `forms.jsonl` and `triggers.jsonl` (the mini dataset). */
export function sourceFromContentDir(dir: string): LexiconSource {
  return {
    lemmas: readJsonl<LexLemma>(join(dir, 'lemmas.jsonl')),
    forms: readJsonl<LexForm>(join(dir, 'forms.jsonl')),
    triggers: readJsonl<LexTrigger>(join(dir, 'triggers.jsonl')),
    label: shortName(dir),
  };
}

/**
 * The pipeline's build output: `<build>/morph/{lemmas,forms}.jsonl`, ranks and top forms from
 * `<build>/freq/lemmas.jsonl` when `freq` has run, and the full trigger list of the `triggers`
 * stage (C4, `<build>/triggers/triggers.jsonl`), the rows `ling.trigger` holds in production.
 */
export function sourceFromBuild(buildDir: string): LexiconSource {
  const morph = join(buildDir, 'morph');
  if (!existsSync(join(morph, 'forms.jsonl')))
    throw new Error(
      `${morph}/forms.jsonl is missing: run "pnpm run pipeline fetch --source snk-morphology" and "pnpm run pipeline morph" first.`,
    );
  const triggersFile = join(buildDir, 'triggers', 'triggers.jsonl');
  if (!existsSync(triggersFile))
    throw new Error(`${triggersFile} is missing: run "pnpm run pipeline triggers" first.`);
  const lemmas = readJsonl<LexLemma>(join(morph, 'lemmas.jsonl'));
  const freqFile = join(buildDir, 'freq', 'lemmas.jsonl');
  let ranked = 0;
  if (existsSync(freqFile)) {
    const byId = new Map(lemmas.map((l) => [l.id, l]));
    for (const r of readJsonl<{ id: number; freqRank: number; topForms: TopForm[] }>(freqFile)) {
      const l = byId.get(r.id);
      if (!l) continue;
      l.freqRank = r.freqRank;
      l.topForms = r.topForms;
      ranked++;
    }
  }
  const triggers = readJsonl<LexTrigger>(triggersFile);
  return {
    lemmas,
    forms: readJsonl<LexForm>(join(morph, 'forms.jsonl')),
    triggers,
    label: `${shortName(buildDir)} (${lemmas.length} lemmas, ${ranked} ranked, ${triggers.length} triggers)`,
  };
}

/** The morphology data in memory. */
export class Lexicon {
  readonly label: string;
  private readonly lemmaById = new Map<number, LexLemma>();
  private readonly byAscii = new Map<string, LexForm[]>();
  private readonly byLemma = new Map<number, LexForm[]>();
  private readonly byLemmaText = new Map<string, LexLemma[]>();
  readonly triggers: readonly LexTrigger[];

  constructor(source: LexiconSource) {
    this.label = source.label;
    for (const l of source.lemmas) {
      this.lemmaById.set(l.id, l);
      const k = foldAscii(l.lemma);
      const list = this.byLemmaText.get(k);
      if (list) list.push(l);
      else this.byLemmaText.set(k, [l]);
    }
    for (const f of source.forms) {
      const k = foldAscii(f.form);
      const a = this.byAscii.get(k);
      if (a) a.push(f);
      else this.byAscii.set(k, [f]);
      const b = this.byLemma.get(f.lemmaId);
      if (b) b.push(f);
      else this.byLemma.set(f.lemmaId, [f]);
    }
    this.triggers = source.triggers;
  }

  get lemmaCount(): number {
    return this.lemmaById.size;
  }

  lemma(id: number): LexLemma | undefined {
    return this.lemmaById.get(id);
  }

  /** Lemmas whose base form folds to `text`'s. */
  lemmasNamed(text: string): readonly LexLemma[] {
    return this.byLemmaText.get(foldAscii(text)) ?? [];
  }

  formsOf(lemmaId: number): readonly LexForm[] {
    return this.byLemma.get(lemmaId) ?? [];
  }

  /** Every form that folds to `form`'s key, as the real port's query returns them. */
  rowsOf(form: string): FormLemmaRow[] {
    const key = foldAscii(form);
    const out: FormLemmaRow[] = [];
    for (const f of this.byAscii.get(key) ?? []) {
      const l = this.lemmaById.get(f.lemmaId);
      if (!l) continue;
      out.push({
        lemmaId: f.lemmaId,
        form: f.form,
        formAscii: key,
        tags: f.tags,
        lemma: l.lemma,
        pos: l.pos,
        gender: l.gender ?? null,
        freqRank: l.freqRank ?? null,
      });
    }
    return out;
  }

  private lemmaRow(l: LexLemma): LemmaRow {
    return {
      id: l.id,
      key: l.key,
      lemma: l.lemma,
      lemmaAscii: foldAscii(l.lemma),
      pos: l.pos,
      gender: l.gender ?? null,
      pattern: l.pattern ?? null,
      aspect: l.aspect ?? null,
      freqRank: l.freqRank ?? null,
      topForms: l.topForms ?? [],
      flags: l.flags ?? {},
    };
  }

  /** A `MorphologyPort` that behaves as the lexicon module's real port. */
  morphology(): MorphologyPort {
    const candidates = (key: string): FormCandidate[] => this.rowsOf(key).map(toCandidate);
    return {
      lookupForms: async (forms) => {
        const out = new Map<string, FormCandidate[]>();
        for (const f of forms) {
          const k = foldAscii(f);
          if (!out.has(k)) out.set(k, orderCandidates(candidates(k), f));
        }
        return out;
      },
      getParadigm: async (lemmaId) => {
        const l = this.lemmaById.get(lemmaId);
        if (!l) throw new Error(`unknown lemma ${lemmaId}`);
        const forms = [...this.formsOf(lemmaId)].sort((a, b) =>
          a.form < b.form ? -1 : a.form > b.form ? 1 : 0,
        );
        return toParadigm(this.lemmaRow(l), forms);
      },
      verifyForm: async (form, want) => {
        const out: FormCandidate[] = [];
        for (const c of orderCandidates(candidates(form), form)) {
          const ok = verifyCandidate(c, form, want);
          if (ok) out.push(ok);
        }
        return out;
      },
      getLemma: async (lemmaId) => {
        const l = this.lemmaById.get(lemmaId);
        return l ? toLemma(this.lemmaRow(l)) : null;
      },
      findLemma: async (text, pos) =>
        this.lemmasNamed(text.trim())
          .filter((l) => pos === undefined || l.pos === pos)
          .map((l) => toLemma(this.lemmaRow(l)))
          .sort(
            (a, b) =>
              (a.freqRank ?? Number.MAX_SAFE_INTEGER) - (b.freqRank ?? Number.MAX_SAFE_INTEGER),
          ),
    };
  }

  /** The analyzer's lemma facts (production reads them from `ling.lemma`). */
  lemmaFacts(ids: readonly number[]): LemmaFacts[] {
    const out: LemmaFacts[] = [];
    for (const id of ids) {
      const l = this.lemmaById.get(id);
      if (!l) continue;
      out.push({
        id: l.id,
        lemma: l.lemma,
        pos: l.pos,
        gender: l.gender ?? null,
        freqRank: l.freqRank ?? null,
        topForms: l.topForms ?? [],
      });
    }
    return out;
  }

  /** The analyzer's trigger rows. */
  triggerFacts(): TriggerFacts[] {
    return this.triggers.map((t) => ({
      id: t.id,
      kind: t.kind,
      lemma: t.lemma,
      lemmaId: t.lemmaId ?? null,
      case: t.case,
    }));
  }

  /** The tutor's trigger list. */
  triggerInfos(): TriggerInfo[] {
    return this.triggers.map((t) => ({
      id: t.id,
      kind: t.kind,
      lemma: t.lemma,
      case: t.case,
      meaningEn: t.meaningEn ?? '',
    }));
  }
}

/**
 * The dictionary the analyzer eval uses: no glosses and never a model call. Glosses are not
 * scored, and `reader.gloss` would add cost without changing a single lemma or case.
 */
export function silentDictionary(): DictionaryPort {
  return {
    getSenses: async (ids) => new Map(ids.map((id) => [id, []])),
    ensureGlosses: async (ids) => new Map(ids.map((id) => [id, []])),
  };
}
