// The ranking of stage freq. Pure functions over line streams, so the tests feed small
// fixtures and the stage feeds the full files.
//
// The formula (docs/handoff/C2.md, "Ranking"):
// 1. Web score of a lemma: the sum of the ARF (average reduced frequency) of every Araneum
//    word form + tag row that the morphology assigns to it. A row fits a lemma when the form
//    is one of the lemma's forms with the row's tag mapped to a form tag (C1's mapping). A row
//    that fits several lemmas (`je`: byť and jesť) is split in proportion to the lemmas'
//    ARF in the Araneum lemma list.
// 2. Subtitle score: the count of every OpenSubtitles word, split over the lemmas of that
//    form in proportion to how the web split the same form (else to the lemmas' web scores).
// 3. Rank each list on its own (1 = most common; a lemma missing from a list gets that
//    list's length + 1), then blend: score = 0.6 · ln(web rank) + 0.4 · ln(subtitle rank),
//    a weighted geometric mean of the two ranks. The lowest score is rank 1; ties go to the
//    better web rank, then the lower id.
// Only lemmas worth teaching are ranked: not retired, not proper names, and no part of
// speech `other` (abbreviations, symbols) except the reflexive `sa` and `si`.
import type { Pos, TopForm } from '@app/contracts';
import { type MappedEntry, mapSnk, POS_BY_CLASS } from '../morph/snk';

export const WEB_WEIGHT = 0.6;
export const SUB_WEIGHT = 0.4;
export const DEFAULT_RANK_LIMIT = 5000;
export const TOP_FORMS = 4;
/** `other` lemmas that are still taught: the reflexive pronouns. */
export const RANKED_OTHER = new Set(['sa|other||1', 'si|other||1']);

export interface FreqLemma {
  id: number;
  key: string;
  lemma: string;
  pos: Pos;
  gender?: string;
  aspect?: string;
  flags?: Record<string, unknown>;
}

export interface FreqForm {
  lemmaId: number;
  form: string;
  tags: string;
}

interface FormEntry {
  lemmaId: number;
  form: string;
  tags: string[];
}

export function isRankable(l: FreqLemma): boolean {
  const f = l.flags ?? {};
  if (f.retired || f.proper) return false;
  if (l.pos === 'other') return RANKED_OTHER.has(l.key);
  return true;
}

/** Forms by spelling, for the lookups of both lists. */
export class MorphIndex {
  readonly lemmas = new Map<number, FreqLemma>();
  private readonly byForm = new Map<string, FormEntry[]>();

  addLemma(l: FreqLemma): void {
    this.lemmas.set(l.id, l);
  }

  addForm(f: FreqForm): void {
    const e: FormEntry = {
      lemmaId: f.lemmaId,
      form: f.form,
      tags: f.tags.split(' ').filter(Boolean),
    };
    const list = this.byForm.get(f.form);
    if (list) list.push(e);
    else this.byForm.set(f.form, [e]);
  }

  /** Entries of a spelling; a capitalised corpus form falls back to lower case. */
  lookup(form: string): FormEntry[] | undefined {
    const exact = this.byForm.get(form);
    if (exact) return exact;
    const lower = form.toLowerCase();
    return lower === form ? undefined : this.byForm.get(lower);
  }

  get formCount(): number {
    return this.byForm.size;
  }
}

/** The form tag an entry has for a mapped corpus tag, or null when it does not fit. */
export function fitTag(m: MappedEntry, tags: readonly string[]): string | null {
  if (m.tag === '') return tags.length === 0 ? '' : null;
  if (tags.includes(m.tag)) return m.tag;
  // Pronouns without agreement (kto, čo) carry `x` + case in the forms file.
  if (m.pos === 'pron') {
    const c = /[1-7]/u.exec(m.tag)?.[0];
    if (c && tags.includes(`x${c}`)) return `x${c}`;
  }
  return null;
}

/** Splits an Araneum lemma list row: the last character of the lemma is the SNK word class. */
export function parseLemmaPos(line: string): { lemma: string; pos: Pos[]; arf: number } | null {
  const cols = line.split('\t');
  if (cols.length < 3) return null;
  const t = cols[0] as string;
  const arf = Number(cols[2]);
  if (t.length < 2 || !Number.isFinite(arf)) return null;
  const letter = t.slice(-1);
  const pos = POS_BY_CLASS[letter];
  if (!pos) return null;
  // Pronominal and numeral adverbs (kde, preto, dvakrát) are adverbs in the morphology.
  return {
    lemma: t.slice(0, -1),
    pos: letter === 'P' || letter === 'N' ? [pos, 'adv'] : [pos],
    arf,
  };
}

export interface FreqStats {
  wordTagRows: number;
  wordTagArf: number;
  matchedRows: number;
  matchedArf: number;
  ambiguousRows: number;
  unparsedRows: number;
  lemmaPosRows: number;
  subtitleWords: number;
  subtitleCount: number;
  matchedSubtitleCount: number;
}

export interface Scored {
  id: number;
  web: number;
  sub: number;
  webRank: number;
  subRank: number;
  score: number;
  rank: number;
}

export interface FreqResult {
  stats: FreqStats;
  /** Every rankable lemma with a score, best first; `rank` is 1-based. */
  scored: Scored[];
  /** Ranked rows for lemmas.jsonl: id, freqRank, topForms. */
  rows: { id: number; freqRank: number; topForms: TopForm[] }[];
}

const SEP = '\t';

export class FreqBuilder {
  readonly stats: FreqStats = {
    wordTagRows: 0,
    wordTagArf: 0,
    matchedRows: 0,
    matchedArf: 0,
    ambiguousRows: 0,
    unparsedRows: 0,
    lemmaPosRows: 0,
    subtitleWords: 0,
    subtitleCount: 0,
    matchedSubtitleCount: 0,
  };
  private readonly prior = new Map<string, number>();
  private readonly web = new Map<number, number>();
  private readonly sub = new Map<number, number>();
  /** lemma → `form\ttag` → ARF */
  private readonly formWeb = new Map<number, Map<string, number>>();
  /** lemma → `form\ttag` → subtitle count, for lemmas the web list misses */
  private readonly formSub = new Map<number, Map<string, number>>();
  /** lower case form → lemma → ARF, to split subtitle counts like the web split them */
  private readonly formLemma = new Map<string, Map<number, number>>();

  constructor(readonly index: MorphIndex) {}

  private priorOf(l: FreqLemma): number {
    return this.prior.get(`${l.lemma}${SEP}${l.pos}`) ?? 0;
  }

  /** Reads the Araneum lemma list (`lemma+class, f, ARF, h`). */
  async readLemmaPos(lines: AsyncIterable<string> | Iterable<string>): Promise<void> {
    const wanted = new Set<string>();
    for (const l of this.index.lemmas.values()) wanted.add(`${l.lemma}${SEP}${l.pos}`);
    for await (const line of lines) {
      const r = parseLemmaPos(line);
      if (!r) continue;
      this.stats.lemmaPosRows++;
      for (const pos of r.pos) {
        const k = `${r.lemma}${SEP}${pos}`;
        if (wanted.has(k)) this.prior.set(k, (this.prior.get(k) ?? 0) + r.arf);
      }
    }
  }

  /** Reads the Araneum word form list with tags (`form, tag, f, ARF, h`). */
  async readWordTag(lines: AsyncIterable<string> | Iterable<string>): Promise<void> {
    const s = this.stats;
    for await (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 4) continue;
      const form = cols[0] as string;
      const tag = cols[1] as string;
      const arf = Number(cols[3]);
      if (!Number.isFinite(arf) || arf <= 0) continue;
      s.wordTagRows++;
      s.wordTagArf += arf;
      const m = mapSnk('x', form, tag);
      if (!m.ok) {
        s.unparsedRows++;
        continue;
      }
      const entries = this.index.lookup(form);
      if (!entries) continue;
      const fits: { e: FormEntry; tag: string; l: FreqLemma }[] = [];
      for (const e of entries) {
        const l = this.index.lemmas.get(e.lemmaId);
        if (!l || l.pos !== m.pos) continue;
        const t = fitTag(m, e.tags);
        if (t !== null && !fits.some((f) => f.e.lemmaId === e.lemmaId)) fits.push({ e, tag: t, l });
      }
      if (fits.length === 0) continue;
      s.matchedRows++;
      s.matchedArf += arf;
      if (fits.length > 1) s.ambiguousRows++;
      const priors = fits.map((f) => this.priorOf(f.l));
      const total = priors.reduce((a, b) => a + b, 0);
      fits.forEach((f, i) => {
        const share = total > 0 ? (priors[i] as number) / total : 1 / fits.length;
        if (share === 0) return;
        const v = arf * share;
        const id = f.e.lemmaId;
        this.web.set(id, (this.web.get(id) ?? 0) + v);
        bump(this.formWeb, id, `${f.e.form}${SEP}${f.tag}`, v);
        bump(this.formLemma, f.e.form.toLowerCase(), id, v);
      });
    }
  }

  /** Reads the OpenSubtitles list (`word count`, one per line). */
  async readSubtitles(lines: AsyncIterable<string> | Iterable<string>): Promise<void> {
    const s = this.stats;
    for await (const line of lines) {
      const sp = line.lastIndexOf(' ');
      if (sp <= 0) continue;
      const word = line.slice(0, sp).toLowerCase();
      const count = Number(line.slice(sp + 1));
      if (!Number.isFinite(count) || count <= 0) continue;
      s.subtitleWords++;
      s.subtitleCount += count;
      let split = this.formLemma.get(word);
      let entries: FormEntry[] | undefined;
      if (!split) {
        entries = this.index.lookup(word);
        if (!entries) continue;
        split = new Map();
        for (const e of entries) split.set(e.lemmaId, this.web.get(e.lemmaId) ?? 0);
      }
      const total = [...split.values()].reduce((a, b) => a + b, 0);
      s.matchedSubtitleCount += count;
      for (const [id, w] of split) {
        const share = total > 0 ? w / total : 1 / split.size;
        if (share === 0) continue;
        this.sub.set(id, (this.sub.get(id) ?? 0) + count * share);
        if (entries) {
          const e = entries.find((x) => x.lemmaId === id);
          if (e) bump(this.formSub, id, `${e.form}${SEP}${e.tags[0] ?? ''}`, count * share);
        }
      }
    }
  }

  /** Ranks the rankable lemmas and picks their top forms. */
  finish(limit = DEFAULT_RANK_LIMIT): FreqResult {
    const ids = new Set<number>();
    for (const id of [...this.web.keys(), ...this.sub.keys()]) {
      const l = this.index.lemmas.get(id);
      if (l && isRankable(l)) ids.add(id);
    }
    const rankOf = (score: Map<number, number>) => {
      const list = [...ids].filter((id) => (score.get(id) ?? 0) > 0);
      list.sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || a - b);
      const ranks = new Map<number, number>();
      list.forEach((id, i) => {
        ranks.set(id, i + 1);
      });
      return { ranks, missing: list.length + 1 };
    };
    const w = rankOf(this.web);
    const s = rankOf(this.sub);
    const scored: Scored[] = [...ids].map((id) => {
      const webRank = w.ranks.get(id) ?? w.missing;
      const subRank = s.ranks.get(id) ?? s.missing;
      return {
        id,
        web: this.web.get(id) ?? 0,
        sub: this.sub.get(id) ?? 0,
        webRank,
        subRank,
        score: WEB_WEIGHT * Math.log(webRank) + SUB_WEIGHT * Math.log(subRank),
        rank: 0,
      };
    });
    scored.sort((a, b) => a.score - b.score || a.webRank - b.webRank || a.id - b.id);
    scored.forEach((x, i) => {
      x.rank = i + 1;
    });
    const rows = scored.slice(0, limit).map((x) => ({
      id: x.id,
      freqRank: x.rank,
      topForms: topForms(this.formWeb.get(x.id) ?? this.formSub.get(x.id)),
    }));
    return { stats: this.stats, scored, rows };
  }
}

function bump<K, J>(map: Map<K, Map<J, number>>, k: K, j: J, v: number): void {
  let inner = map.get(k);
  if (!inner) {
    inner = new Map();
    map.set(k, inner);
  }
  inner.set(j, (inner.get(j) ?? 0) + v);
}

/**
 * The most used forms with their share of the lemma's total. Shares are rounded down to
 * three decimals, so they never sum to more than 1. Forms with a share below 0.001 are left out.
 */
export function topForms(counts: Map<string, number> | undefined, n = TOP_FORMS): TopForm[] {
  if (!counts) return [];
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([k, v]) => {
      const [form, tag] = k.split(SEP) as [string, string];
      return { form, tag, share: Math.floor((v / total) * 1000) / 1000 };
    })
    .filter((f) => f.share > 0);
}
