// The form map of a word and the stem of a word for its pattern.
import type { FormMap } from '@app/contracts';
import { splitTags, tryParseTag } from './tags';

/** One row of a word's table of forms, as `ling.form` or `forms.jsonl` hold it. */
export type FormRow = { form: string; tags: string | readonly string[] };

/** The key of a form in a form map: lower case, in NFC. */
export function formKey(form: string): string {
  return form.normalize('NFC').trim().toLowerCase();
}

/**
 * Builds the form map of a word from its table of forms: every form (lower case, NFC) to its
 * form tags. Rows that differ only in capitals are merged; tags keep their first order and
 * are not repeated. Throws a RangeError on an invalid tag.
 */
export function buildFormMap(rows: readonly FormRow[]): FormMap {
  const map: FormMap = {};
  for (const row of rows) {
    const key = formKey(row.form);
    if (key === '') continue;
    const tags = typeof row.tags === 'string' ? splitTags(row.tags) : row.tags;
    let list = map[key];
    if (!list) {
      list = [];
      map[key] = list;
    }
    for (const tag of tags) {
      if (tryParseTag(tag) === null) throw new RangeError(`not a form tag: ${JSON.stringify(tag)}`);
      if (!list.includes(tag)) list.push(tag);
    }
  }
  return map;
}

/** Every form of a form map that carries a tag. */
export function formsWithTag(formMap: FormMap, tag: string): string[] {
  return Object.keys(formMap).filter((form) => formMap[form]?.includes(tag));
}

/**
 * The stem of one form for its pattern: the form without the ending its pattern has for the
 * tag. Null when the pattern has no ending for the tag or the form does not end with it.
 * `findStem('ulice', 's2', { s2: 'e' }) === 'ulic'`.
 */
export function findStem(
  form: string,
  tag: string,
  endings: Readonly<Record<string, string>>,
): string | null {
  const ending = endings[tag];
  if (ending === undefined) return null;
  const f = formKey(form);
  const e = formKey(ending);
  if (!f.endsWith(e) || f.length === e.length) return null;
  return f.slice(0, f.length - e.length);
}

/**
 * The stem of a word for its pattern: the stem that most forms of the form map agree on.
 * Ties go to the longer stem. Null when no form fits the pattern's endings.
 * For *žena* with the endings of pattern žena it is `žen` (žien is an exception and is outvoted).
 */
export function stemOf(formMap: FormMap, endings: Readonly<Record<string, string>>): string | null {
  const votes = new Map<string, number>();
  for (const [form, tags] of Object.entries(formMap)) {
    for (const tag of tags) {
      const stem = findStem(form, tag, endings);
      if (stem !== null) votes.set(stem, (votes.get(stem) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestVotes = 0;
  for (const [stem, n] of votes) {
    if (n > bestVotes || (n === bestVotes && best !== null && stem.length > best.length)) {
      best = stem;
      bestVotes = n;
    }
  }
  return best;
}
