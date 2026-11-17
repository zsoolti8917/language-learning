// The table of forms on the word page: six cases by two numbers, built from `LemmaDetail.forms`.
import type { Case, FormEntry, GrammaticalNumber, TopForm } from '@app/contracts';

/** The six cases the table shows, in school order. The vocative is listed under the table. */
export const TABLE_CASES = ['nom', 'gen', 'dat', 'acc', 'loc', 'ins'] as const satisfies Case[];
export const TABLE_NUMBERS = ['sg', 'pl'] as const satisfies GrammaticalNumber[];

export interface ParadigmCell {
  forms: { form: string; top: boolean }[];
}

export interface ParadigmTable {
  /** 'number': six cases by singular and plural. 'case': one column (pronouns without number). */
  kind: 'number' | 'case';
  rows: { case: (typeof TABLE_CASES)[number]; cells: ParadigmCell[] }[];
  /** Vocative forms that differ from the nominative. */
  vocative: string[];
  /** Forms that have no case (verbs, invariable words), each once. */
  other: string[];
}

function add(list: { form: string; top: boolean }[], form: string, top: boolean) {
  const found = list.find((f) => f.form === form);
  if (found) found.top ||= top;
  else list.push({ form, top });
}

/**
 * Groups the forms by case and number. A form counts as most used when the lemma's
 * `topForms` names it with the same tag.
 */
export function buildParadigm(forms: FormEntry[], topForms: TopForm[]): ParadigmTable {
  const isTop = (form: string, tag: string) =>
    topForms.some((t) => t.form === form && t.tag === tag);
  const withNumber = forms.some((f) => f.readings.some((r) => r.case && r.number));
  const kind: ParadigmTable['kind'] = withNumber ? 'number' : 'case';
  const columns: readonly (GrammaticalNumber | null)[] = withNumber ? TABLE_NUMBERS : [null];
  const rows = TABLE_CASES.map((c) => ({
    case: c,
    cells: columns.map((n) => {
      const cell: ParadigmCell = { forms: [] };
      for (const entry of forms) {
        for (const r of entry.readings) {
          if (r.case === c && (n === null || r.number === n)) {
            add(cell.forms, entry.form, isTop(entry.form, r.tag));
          }
        }
      }
      return cell;
    }),
  }));

  const nominative = new Set(
    forms.filter((f) => f.readings.some((r) => r.case === 'nom')).map((f) => f.form),
  );
  const vocative = forms
    .filter((f) => f.readings.some((r) => r.case === 'voc') && !nominative.has(f.form))
    .map((f) => f.form);
  const other = forms
    .filter((f) => f.readings.length === 0 || f.readings.every((r) => !r.case))
    .map((f) => f.form)
    .filter((f, i, all) => all.indexOf(f) === i);

  const hasCaseForms = rows.some((r) => r.cells.some((c) => c.forms.length > 0));
  return { kind, rows: hasCaseForms ? rows : [], vocative, other };
}
