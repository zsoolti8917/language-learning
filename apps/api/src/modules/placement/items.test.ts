// The pure rules of the placement check, on a generated candidate list of 3,000 ranks.
import { PlacementItemSchema, type Pos } from '@app/contracts';
import { loadMini } from '@app/testkit/mini';
import { describe, expect, it } from 'vitest';
import {
  buildCaseItems,
  buildResult,
  buildVocabRound,
  type Candidate,
  DONT_KNOW,
  firstMissStratum,
  GAP,
  knownUpToRank,
  pickCaseExercises,
  roundQuota,
  type StoredVocab,
  stratumOf,
  WRONG_OPTIONS,
  wrongOptions,
} from './items';

const POS: Pos[] = ['noun', 'verb', 'adj'];
const CANDIDATES: Candidate[] = Array.from({ length: 3000 }, (_, i) => ({
  lemmaId: 1000 + i + 1,
  lemma: `w${i + 1}`,
  pos: POS[(i + 1) % 3] as Pos,
  rank: i + 1,
  gloss: `gloss ${i + 1}`,
}));
const RUN = '01900000-0000-7000-8000-000000000001';

function answered(items: StoredVocab[], knowsUpTo: number): StoredVocab[] {
  return items.map((i) => ({ ...i, answered: true, correct: i.rank <= knowsUpTo }));
}

describe('vocabulary rounds', () => {
  it('round 1 takes two words from each of the six strata', () => {
    const round = buildVocabRound(RUN, 1, CANDIDATES, []);
    expect(round).toHaveLength(12);
    const perStratum = [0, 1, 2, 3, 4, 5].map(
      (s) => round.filter((i) => stratumOf(i.rank) === s).length,
    );
    expect(perStratum).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('items carry no answers and end with "I don\'t know"', () => {
    for (const s of buildVocabRound(RUN, 1, CANDIDATES, [])) {
      expect(PlacementItemSchema.parse(s.item)).toEqual(s.item);
      expect(Object.keys(s.item).sort()).toEqual(['itemId', 'kind', 'lemma', 'lemmaId', 'options']);
      expect(s.item.options.at(-1)).toBe(DONT_KNOW);
      expect(s.item.options).toHaveLength(WRONG_OPTIONS + 2);
      expect(new Set(s.item.options).size).toBe(s.item.options.length);
      expect(s.item.options[s.correctIndex]).toBe(`gloss ${s.rank}`);
    }
  });

  it('is the same for the same run id and differs for another', () => {
    const a = buildVocabRound(RUN, 1, CANDIDATES, []);
    expect(buildVocabRound(RUN, 1, CANDIDATES, [])).toEqual(a);
    const other = buildVocabRound('01900000-0000-7000-8000-000000000002', 1, CANDIDATES, []);
    expect(other.map((i) => i.rank)).not.toEqual(a.map((i) => i.rank));
  });

  it('wrong options are glosses of lemmas with the same part of speech and a similar rank', () => {
    const target = CANDIDATES[1199] as Candidate; // rank 1200
    const wrong = wrongOptions(target, CANDIDATES, () => 0.3);
    expect(wrong).toHaveLength(WRONG_OPTIONS);
    for (const g of wrong) {
      const c = CANDIDATES.find((x) => x.gloss === g) as Candidate;
      expect(c.pos).toBe(target.pos);
      expect(Math.abs(c.rank - target.rank)).toBeLessThanOrEqual(15);
      expect(g).not.toBe(target.gloss);
    }
  });

  it('falls back to other parts of speech when too few share it', () => {
    const few: Candidate[] = [
      { lemmaId: 1, lemma: 'a', pos: 'prep', rank: 1, gloss: 'in' },
      { lemmaId: 2, lemma: 'b', pos: 'prep', rank: 2, gloss: 'on' },
      { lemmaId: 3, lemma: 'c', pos: 'noun', rank: 3, gloss: 'house' },
      { lemmaId: 4, lemma: 'd', pos: 'noun', rank: 4, gloss: 'House' },
      { lemmaId: 5, lemma: 'e', pos: 'verb', rank: 5, gloss: 'to be' },
    ];
    const wrong = wrongOptions(few[0] as Candidate, few, () => 0);
    expect(wrong[0]).toBe('on');
    expect(wrong).toHaveLength(3);
    expect(wrong.filter((g) => g.toLowerCase() === 'house')).toHaveLength(1);
  });

  it('later rounds take their words around the first stratum with a miss', () => {
    const r1 = answered(buildVocabRound(RUN, 1, CANDIDATES, []), 1000);
    expect(firstMissStratum(r1)).toBe(2);
    expect([...roundQuota(2, r1)].sort()).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
    ]);
    const r2 = buildVocabRound(RUN, 2, CANDIDATES, r1);
    expect(r2).toHaveLength(12);
    expect(r2.every((i) => i.rank > 500 && i.rank <= 2000)).toBe(true);
    // No word is asked twice.
    const shown = new Set(r1.map((i) => i.item.lemmaId));
    expect(r2.some((i) => shown.has(i.item.lemmaId))).toBe(false);

    // Nothing known: the window is clipped at the bottom.
    const none = answered(buildVocabRound(RUN, 1, CANDIDATES, []), 0);
    expect([...roundQuota(2, none)].sort()).toEqual([
      [0, 6],
      [1, 6],
    ]);
    // Nothing missed: the words come from around the top stratum.
    const all = answered(buildVocabRound(RUN, 1, CANDIDATES, []), 3000);
    expect(firstMissStratum(all)).toBeNull();
    expect(buildVocabRound(RUN, 2, CANDIDATES, all).every((i) => i.rank > 2000)).toBe(true);
  });

  it('a stratum without words passes its share to the nearest one', () => {
    const small = CANDIDATES.slice(0, 72);
    const r1 = buildVocabRound(RUN, 1, small, []);
    expect(r1).toHaveLength(12);
    expect(r1.every((i) => i.stratum === 0)).toBe(true);
  });
});

describe('known up to rank', () => {
  const item = (stratum: number, correct: boolean): StoredVocab =>
    ({ stratum, answered: true, correct }) as StoredVocab;

  it('counts leading strata with at least 85% right', () => {
    const items = [
      ...Array.from({ length: 6 }, () => item(0, true)),
      ...Array.from({ length: 7 }, (_, i) => item(1, i < 6)), // 6/7 = 86%
      ...Array.from({ length: 7 }, (_, i) => item(2, i < 5)), // 5/7 = 71%
      ...Array.from({ length: 2 }, () => item(3, true)),
    ];
    expect(knownUpToRank(items)).toBe(1000);
    expect(knownUpToRank([])).toBe(0);
    expect(knownUpToRank(Array.from({ length: 6 }, (_, s) => item(s, true)))).toBe(3000);
  });
});

describe('case round', () => {
  const mini = loadMini();
  const teaching = mini.lessons.filter((l) => l.case || l.number).map((l) => l.id);
  const exercises = mini.exercises
    .filter((e) => e.kind === 'cloze' && e.lessonId)
    .map((e) => ({
      id: e.id,
      lessonId: e.lessonId as string,
      sentenceSk: e.sentenceSk,
      sentenceEn: e.sentenceEn,
      start: e.target.start,
      end: e.target.end,
      lemmaIds: e.target.lemmaIds,
      cue: e.target.cue,
      answers: e.target.answers,
      difficulty: e.difficulty,
      verified: e.verified,
    }));

  it('takes 16 typed gaps of medium difficulty, two per teaching lesson', () => {
    expect(teaching).toHaveLength(8);
    const picked = pickCaseExercises(teaching, exercises);
    expect(picked).toHaveLength(16);
    for (const l of teaching) expect(picked.filter((e) => e.lessonId === l)).toHaveLength(2);
    // acc-sg and loc-sg have gaps of 0.35 and 0.45: the 0.45 ones are picked.
    for (const e of picked) expect(Math.abs(e.difficulty - 0.5)).toBeLessThanOrEqual(0.05);
    expect(picked.every((e) => e.lemmaIds.length === 1)).toBe(true);
  });

  it('writes the gap as ___ so items hold no answer', () => {
    const items = buildCaseItems(pickCaseExercises(teaching, exercises));
    for (const s of items) {
      expect(PlacementItemSchema.parse(s.item)).toEqual(s.item);
      expect(s.item.sentenceSk.slice(s.item.blank.start, s.item.blank.end)).toBe(GAP);
      for (const a of s.answers) expect(s.item.sentenceSk.includes(a)).toBe(false);
    }
    expect(items[0]?.item.itemId).toBe(`c-${teaching[0]}-1`);
  });

  it('tests out a lesson when both gaps are right and starts at the first one left', () => {
    const items = buildCaseItems(pickCaseExercises(teaching, exercises)).map((s, i) => ({
      ...s,
      answered: true,
      // acc-sg both right, loc-sg one right, gen-sg both right.
      correct: i < 2 || i === 2 || i === 4 || i === 5,
    }));
    const course = [...teaching, 'mixed'];
    const r = buildResult(items, teaching, course);
    expect(r.lessonsTestedOut).toEqual(['acc-sg', 'gen-sg']);
    expect(r.startLessonId).toBe('loc-sg');
    expect(r.buckets[1]).toEqual({ lessonId: 'loc-sg', correct: 1, total: 2 });
    const all = buildResult(
      items.map((s) => ({ ...s, correct: true })),
      teaching,
      course,
    );
    expect(all.lessonsTestedOut).toEqual(teaching);
    expect(all.startLessonId).toBe('mixed');
  });
});
