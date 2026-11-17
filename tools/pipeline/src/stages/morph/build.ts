// Turns the SNK file, read as a stream of lines "lemma<TAB>form<TAB>tag", into lemma and form
// rows with ids from the registry. It does no input or output itself, so tests feed it lines.
import { type Aspect, CASES, type Case, GENDERS, type Gender, POS, type Pos } from '@app/contracts';
import { type LemmaRegistry, lemmaKey, parseLemmaKey } from '../../lib/registry';
import { LEMMA_OVERRIDES, redirectLemma } from './overrides';
import {
  type AdjPattern,
  assignAdjPattern,
  assignNounPattern,
  type NounPattern,
  type NounPatternResult,
} from './patterns';
import { compareTags, type DropReason, mapSnk } from './snk';

export interface LemmaOut {
  id: number;
  key: string;
  lemma: string;
  pos: Pos;
  gender?: Gender;
  pattern?: string;
  aspect?: Aspect;
  flags: LemmaFlagsOut;
}

/** LemmaFlags of the contract, plus `cases`: the cases a preposition governs. */
export interface LemmaFlagsOut {
  proper?: boolean;
  irregular?: boolean;
  pluralOnly?: boolean;
  indeclinable?: boolean;
  retired?: boolean;
  cases?: Case[];
}

export interface FormOut {
  lemmaId: number;
  form: string;
  tags: string;
}

export interface NounNote {
  id: number;
  lemma: string;
  gender: Gender;
  result: NounPatternResult;
}

export interface MorphStats {
  lines: number;
  entries: number;
  dropped: Record<DropReason, number>;
  /** Tags that failed to parse, with their count. */
  unparsedTags: Record<string, number>;
  /** A few lines per unparsed tag. */
  unparsedExamples: string[];
  malformedLines: number;
  lemmasByPos: Record<string, number>;
  formsByPos: Record<string, number>;
  patterns: Record<string, number>;
  irregularByPos: Record<string, number>;
  retired: number;
  newIds: number;
}

export interface MorphResult {
  lemmas: LemmaOut[];
  forms: FormOut[];
  nouns: NounNote[];
  stats: MorphStats;
}

interface Acc {
  lemma: string;
  pos: Pos;
  gender?: Gender;
  /** form → tags separated by spaces */
  forms: Map<string, string>;
  paradigms: Map<string, number>;
  aspects: Map<Aspect, number>;
  infinitiveAspect?: Aspect;
  governs: Set<Case>;
  proper: boolean;
  general: boolean;
}

const DECLINING = new Set<Pos>(['noun', 'adj', 'pron', 'num']);

function bump<K>(m: Map<K, number>, k: K): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function top<K>(m: Map<K, number>): K | undefined {
  let best: K | undefined;
  let n = -1;
  for (const [k, c] of m)
    if (c > n) {
      best = k;
      n = c;
    }
  return best;
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pronouns that do not agree (one gender and one number, like kto and čo) get `x` + case. */
function pronounTags(acc: Acc): void {
  if (acc.pos !== 'pron') return;
  const genders = new Set<string>();
  const numbers = new Set<string>();
  for (const tags of acc.forms.values())
    for (const t of tags.split(' '))
      if (t.length === 3) {
        genders.add(t[2] as string);
        numbers.add(t[0] as string);
      }
  if (genders.size !== 1 || numbers.size !== 1) return;
  for (const [form, tags] of acc.forms)
    acc.forms.set(
      form,
      tags
        .split(' ')
        .map((t) => (t.length === 3 ? `x${t[1]}` : t))
        .join(' '),
    );
}

function sortTags(tags: string): string {
  const list = [...new Set(tags.split(' '))];
  const real = list.filter((t) => t !== '');
  return (real.length > 0 ? real : []).sort(compareTags).join(' ');
}

export async function buildMorphology(
  lines: AsyncIterable<string>,
  registry: LemmaRegistry,
): Promise<MorphResult> {
  const stats: MorphStats = {
    lines: 0,
    entries: 0,
    dropped: { misspelling: 0, degree: 0, unparsed: 0 },
    unparsedTags: {},
    unparsedExamples: [],
    malformedLines: 0,
    lemmasByPos: {},
    formsByPos: {},
    patterns: {},
    irregularByPos: {},
    retired: 0,
    newIds: 0,
  };
  const groups = new Map<string, Acc>();

  for await (const line of lines) {
    stats.lines++;
    if (line === '') continue;
    const parts = line.split('\t');
    if (parts.length !== 3) {
      stats.malformedLines++;
      continue;
    }
    const [lemma0, form, tag] = parts as [string, string, string];
    const m = mapSnk(lemma0, form, tag);
    if (!m.ok) {
      stats.dropped[m.reason]++;
      if (m.reason === 'unparsed') {
        const n = (stats.unparsedTags[tag] ?? 0) + 1;
        stats.unparsedTags[tag] = n;
        if (n === 1 && stats.unparsedExamples.length < 50) stats.unparsedExamples.push(line);
      }
      continue;
    }
    stats.entries++;
    const lemma = redirectLemma(lemma0, m);
    const key = lemmaKey(lemma, m.pos, m.gender);
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        lemma,
        pos: m.pos,
        forms: new Map(),
        paradigms: new Map(),
        aspects: new Map(),
        governs: new Set(),
        proper: false,
        general: false,
      };
      if (m.gender) acc.gender = m.gender;
      groups.set(key, acc);
    }
    const prev = acc.forms.get(form);
    if (prev === undefined) acc.forms.set(form, m.tag);
    else if (!` ${prev} `.includes(` ${m.tag} `)) acc.forms.set(form, `${prev} ${m.tag}`);
    bump(acc.paradigms, m.paradigm);
    if (m.aspect) {
      bump(acc.aspects, m.aspect);
      if (m.verbForm === 'I') acc.infinitiveAspect = m.aspect;
    }
    if (m.governs) acc.governs.add(m.governs);
    if (m.proper) acc.proper = true;
    if (m.general) acc.general = true;
  }

  registry.assignAll(groups.keys());
  stats.newIds = registry.added;

  const lemmas: LemmaOut[] = [];
  const forms: FormOut[] = [];
  const nouns: NounNote[] = [];
  for (const [key, acc] of groups) {
    const id = registry.idOf(key) as number;
    pronounTags(acc);
    const flags: LemmaFlagsOut = {};
    const override = LEMMA_OVERRIDES[key];
    const out: LemmaOut = { id, key, lemma: acc.lemma, pos: acc.pos, flags };
    if (acc.gender) out.gender = acc.gender;

    const formRows: FormOut[] = [];
    const tagSet = new Set<string>();
    let singular = false;
    let plural = false;
    for (const [form, tags0] of acc.forms) {
      const tags = sortTags(tags0);
      formRows.push({ lemmaId: id, form, tags });
      for (const t of tags.split(' ')) {
        if (t === '') continue;
        tagSet.add(t);
        if (t[0] === 's') singular = true;
        if (t[0] === 'p') plural = true;
      }
    }
    formRows.sort((a, b) => byCodePoint(a.form, b.form));

    if ((acc.proper || /^\p{Lu}/u.test(acc.lemma)) && (acc.pos === 'noun' || acc.pos === 'adj'))
      flags.proper = true;
    if (acc.pos === 'noun' && plural && !singular) flags.pluralOnly = true;
    if (DECLINING.has(acc.pos) && acc.forms.size === 1 && tagSet.size > 1)
      flags.indeclinable = true;
    if (acc.pos === 'prep' && acc.governs.size > 0)
      flags.cases = CASES.filter((c: Case) => acc.governs.has(c));
    if (acc.pos === 'verb') {
      const a = acc.infinitiveAspect ?? top(acc.aspects);
      if (a) out.aspect = a;
    }

    const paradigm = top(acc.paradigms) ?? '';
    if (acc.pos === 'noun' && acc.gender) {
      const slots = new Map<string, string[]>();
      for (const r of formRows)
        for (const t of r.tags.split(' '))
          if (t !== '') slots.set(t, [...(slots.get(t) ?? []), r.form]);
      const result: NounPatternResult = override?.noPattern
        ? { irregular: true, reason: 'no rule' }
        : assignNounPattern({ lemma: acc.lemma, gender: acc.gender, paradigm, slots });
      if (result.pattern) out.pattern = result.pattern satisfies NounPattern;
      if (result.irregular) flags.irregular = true;
      nouns.push({ id, lemma: acc.lemma, gender: acc.gender, result });
    } else if (acc.pos === 'adj') {
      const slots = new Map<string, string[]>();
      for (const r of formRows)
        for (const t of r.tags.split(' '))
          if (t !== '') slots.set(t, [...(slots.get(t) ?? []), r.form]);
      const result = assignAdjPattern({ lemma: acc.lemma, paradigm, slots });
      if (result.pattern) out.pattern = result.pattern satisfies AdjPattern;
      if (result.irregular) flags.irregular = true;
    }
    if (override?.flags) Object.assign(flags, override.flags);

    lemmas.push(out);
    for (const r of formRows) forms.push(r);
    stats.lemmasByPos[acc.pos] = (stats.lemmasByPos[acc.pos] ?? 0) + 1;
    stats.formsByPos[acc.pos] = (stats.formsByPos[acc.pos] ?? 0) + formRows.length;
    if (out.pattern) stats.patterns[out.pattern] = (stats.patterns[out.pattern] ?? 0) + 1;
    if (flags.irregular) stats.irregularByPos[acc.pos] = (stats.irregularByPos[acc.pos] ?? 0) + 1;
  }

  // Registered lemmas the source no longer has stay, flagged as retired: an id never disappears.
  for (const [id, key] of registry.entries()) {
    if (groups.has(key)) continue;
    const k = parseLemmaKey(key);
    const pos = (POS as readonly string[]).includes(k.pos) ? (k.pos as Pos) : 'other';
    const row: LemmaOut = { id, key, lemma: k.lemma, pos, flags: { retired: true } };
    if ((GENDERS as readonly string[]).includes(k.gender)) row.gender = k.gender as Gender;
    lemmas.push(row);
    stats.retired++;
  }

  lemmas.sort((a, b) => a.id - b.id);
  forms.sort((a, b) => a.lemmaId - b.lemmaId || byCodePoint(a.form, b.form));
  nouns.sort((a, b) => a.id - b.id);
  return { lemmas, forms, nouns, stats };
}

/** A lemma row as written to lemmas.jsonl: empty flags left out. */
export function lemmaRow(l: LemmaOut): Record<string, unknown> {
  const { flags, ...rest } = l;
  return Object.keys(flags).length > 0 ? { ...rest, flags } : rest;
}
