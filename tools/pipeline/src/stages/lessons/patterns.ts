// Declension patterns: the authored files in content/authored/patterns/ name a model word, a
// stem and its stem changes; the endings are taken from the real forms of the model word.
import { readFile } from 'node:fs/promises';
import { type FormMap, GenderSchema, PatternPosSchema, type PatternRow } from '@app/contracts';
import { formKey } from '@app/ling';
import { parse } from 'yaml';
import { z } from 'zod';
import { findLemma, formsWith, type Morphology } from '../triggers/morphology';

export const AuthoredPatternSchema = z
  .object({
    id: z.string().regex(/^[a-z]+$/u),
    labelSk: z.string().min(1),
    pos: PatternPosSchema,
    gender: GenderSchema.optional(),
    /** The traditional model word. */
    model: z.string().min(1),
    /** The everyday word shown beside it. */
    everyday: z.string().min(1).optional(),
    /** What every form of the model word starts with, unless `stems` says otherwise. */
    stem: z.string().min(1),
    /** Another stem for some tags: { žien: [p2] }. */
    stems: z.record(z.string(), z.array(z.string())).optional(),
    /** The form to take when the model word has two for a tag. */
    prefer: z.record(z.string(), z.string()).optional(),
    notesEn: z.string().min(1),
  })
  .strict();
export type AuthoredPattern = z.infer<typeof AuthoredPatternSchema>;

const PatternFileSchema = z.object({ patterns: z.array(AuthoredPatternSchema) }).strict();

export async function readAuthoredPatterns(files: readonly string[]): Promise<AuthoredPattern[]> {
  const out: AuthoredPattern[] = [];
  for (const file of files) {
    const parsed = PatternFileSchema.safeParse(parse(await readFile(file, 'utf8')));
    if (!parsed.success)
      throw new Error(
        `${file}: ${parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    out.push(...parsed.data.patterns);
  }
  return out;
}

const NOUN_TAGS = ['s', 'p'].flatMap((n) => [1, 2, 3, 4, 5, 6, 7].map((c) => `${n}${c}`));
const ADJ_TAGS = ['m', 'i', 'f', 'n'].flatMap((g) => NOUN_TAGS.map((t) => `${t}${g}`));

/** The tags a pattern of this part of speech has endings for. */
export function patternTags(pos: 'noun' | 'adj'): string[] {
  return pos === 'noun' ? NOUN_TAGS : ADJ_TAGS;
}

/** The stem a pattern uses for a tag. */
export function stemFor(p: Pick<AuthoredPattern, 'stem' | 'stems'>, tag: string): string {
  for (const [stem, tags] of Object.entries(p.stems ?? {})) if (tags.includes(tag)) return stem;
  return p.stem;
}

/** The form of the model word a pattern takes for a tag, or why there is none. */
export function modelForm(
  p: AuthoredPattern,
  map: FormMap,
  tag: string,
): { form: string } | { problem: string } {
  const forms = formsWith(map, tag);
  if (forms.length === 0) return { problem: `${p.model} has no form ${tag}` };
  const preferred = p.prefer?.[tag];
  if (preferred !== undefined) {
    const f = formKey(preferred);
    return forms.includes(f)
      ? { form: f }
      : { problem: `prefer ${tag}: ${preferred} is not a ${tag} form of ${p.model}` };
  }
  if (forms.length > 1)
    return { problem: `${p.model} has ${forms.join('/')} for ${tag}; name one in prefer` };
  return { form: forms[0] as string };
}

export interface BuiltPattern {
  row?: PatternRow;
  problems: string[];
  notes: string[];
}

/** One pattern row: the endings of the model word's real forms after the stem. */
export function buildPattern(m: Morphology, p: AuthoredPattern): BuiltPattern {
  const problems: string[] = [];
  const notes: string[] = [];
  const where = `pattern ${p.id}`;
  const lemmaPos = p.pos === 'noun' ? (['noun'] as const) : (['adj'] as const);
  const model = findLemma(m, p.model, lemmaPos, p.gender);
  const fail = (msg: string) => (m.complete ? problems : notes).push(`${where}: ${msg}`);
  if (!model) {
    fail(`no lemma ${p.model} (${p.pos}${p.gender ? ` ${p.gender}` : ''}) in the morphology`);
    return { problems, notes };
  }
  const everyday = p.everyday ? findLemma(m, p.everyday, lemmaPos, p.gender) : undefined;
  if (p.everyday && !everyday) fail(`no lemma ${p.everyday} in the morphology`);
  if (everyday && everyday.pattern !== undefined && everyday.pattern !== p.id)
    problems.push(`${where}: ${p.everyday} follows ${everyday.pattern} in the morphology`);
  if (model.pattern !== undefined && model.pattern !== p.id)
    problems.push(`${where}: ${p.model} follows ${model.pattern} in the morphology`);
  const map = m.forms.get(model.id) ?? {};
  const endings: Record<string, string> = {};
  for (const tag of patternTags(p.pos)) {
    const got = modelForm(p, map, tag);
    if ('problem' in got) {
      fail(got.problem);
      continue;
    }
    const stem = formKey(stemFor(p, tag));
    if (!got.form.startsWith(stem)) {
      problems.push(`${where}: ${got.form} (${tag}) does not start with the stem ${stem}`);
      continue;
    }
    endings[tag] = got.form.slice(stem.length);
  }
  const row: PatternRow = {
    id: p.id,
    labelSk: p.labelSk,
    pos: p.pos,
    modelLemmaId: model.id,
    endings,
    notesEn: p.notesEn.trim(),
  };
  if (p.gender) row.gender = p.gender;
  if (everyday) row.everydayModelLemmaId = everyday.id;
  return { row, problems, notes };
}

/** Rebuilds the model word's forms from a pattern: tag → stem + ending. */
export function rebuildForms(
  p: Pick<AuthoredPattern, 'stem' | 'stems'>,
  endings: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(endings).map(([tag, e]) => [tag, `${formKey(stemFor(p, tag))}${e}`]),
  );
}
