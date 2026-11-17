// Proves the "Done when" list of F9: every row parses, every link resolves, every exercise
// answer is a form of its lemma with the claimed tag, and the 72 lemma ids are pinned.
import { readdirSync, readFileSync } from 'node:fs';
import {
  CONTENT_FILES,
  type ContentFileName,
  type ExerciseRow,
  examples,
  type Gender,
  MANIFEST_FILE,
  ManifestSchema,
} from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { loadMini, MINI_DIR, MINI_LEMMA_IDS, miniFormMap, readContentFile } from './index';

const mini = loadMini();
const CASE_DIGIT = {
  nom: '1',
  gen: '2',
  dat: '3',
  acc: '4',
  voc: '5',
  loc: '6',
  ins: '7',
} as const;
const GENDER_LETTER: Record<Gender, string> = { m_anim: 'm', m_inan: 'i', f: 'f', n: 'n' };

function tagsOf(lemmaId: number, form: string): string[] | undefined {
  const row = mini.formsByLemma.get(lemmaId)?.find((f) => f.form === form);
  if (!row) return undefined;
  return row.tags === '' ? [''] : row.tags.split(' ');
}

/** The form tag an exercise claims for one of its target lemmas. */
function expectedTag(ex: ExerciseRow, lemmaId: number): string {
  const lemma = mini.lemmaById.get(lemmaId);
  const base = `${ex.number === 'sg' ? 's' : 'p'}${CASE_DIGIT[ex.case]}`;
  return lemma?.pos === 'noun' ? base : `${base}${GENDER_LETTER[ex.gender]}`;
}

function unique<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}

describe('files', () => {
  it('holds exactly the 11 files of a content set', () => {
    const data = readdirSync(MINI_DIR).filter((f) => f.endsWith('.jsonl') || f.endsWith('.json'));
    expect(data.sort()).toEqual([...Object.keys(CONTENT_FILES), MANIFEST_FILE].sort());
  });

  it.each(Object.keys(CONTENT_FILES) as ContentFileName[])('parses every row of %s', (file) => {
    const rows = readContentFile(MINI_DIR, file);
    expect(rows.length).toBeGreaterThan(0);
    // Parsing is strict about the shape; also no row carries keys the schema does not know.
    const raw = readFileSync(`${MINI_DIR}${file}`, 'utf8').trim().split('\n');
    expect(raw).toHaveLength(rows.length);
  });

  it('has a manifest whose counts match the files', () => {
    const manifest = ManifestSchema.parse(
      JSON.parse(readFileSync(`${MINI_DIR}${MANIFEST_FILE}`, 'utf8')),
    );
    for (const file of Object.keys(CONTENT_FILES) as ContentFileName[]) {
      const key = file.replace('.jsonl', '');
      expect(manifest.counts[key], file).toBe(readContentFile(MINI_DIR, file).length);
    }
  });

  it('has the sizes the specification asks for', () => {
    expect(mini.lemmas).toHaveLength(72);
    expect(mini.patterns).toHaveLength(16);
    expect(mini.triggers.length).toBeGreaterThanOrEqual(18);
    expect(mini.lessons).toHaveLength(9);
    expect(mini.exercises.length).toBeGreaterThanOrEqual(80);
    expect(mini.sentences).toHaveLength(40);
    expect(mini.scenarios.map((s) => s.mode).sort()).toEqual(['case_coach', 'scenario']);
    expect(mini.library).toHaveLength(1);
    const words = mini.library[0]?.body.match(/\p{L}+/gu) ?? [];
    expect(words.length).toBeGreaterThanOrEqual(70);
    expect(words.length).toBeLessThanOrEqual(90);
  });
});

describe('lemma ids', () => {
  it('pins the 72 ids of the table', () => {
    expect(mini.lemmas.map((l) => [l.id, l.lemma])).toEqual(
      Object.entries(MINI_LEMMA_IDS).map(([lemma, id]) => [id, lemma]),
    );
    expect(Object.keys(MINI_LEMMA_IDS)).toHaveLength(72);
    expect(Object.values(MINI_LEMMA_IDS)).toEqual(Array.from({ length: 72 }, (_, i) => i + 1));
  });

  it('builds every key from lemma, part of speech and gender', () => {
    for (const l of mini.lemmas) expect(l.key).toBe(`${l.lemma}|${l.pos}|${l.gender ?? ''}|1`);
    expect(unique(mini.lemmas.map((l) => l.key))).toBe(true);
  });
});

describe('lemmas, forms and senses', () => {
  it('gives every lemma forms, a gloss, a rank and its most used forms', () => {
    const ranks = mini.lemmas.map((l) => l.freqRank);
    expect(unique(ranks)).toBe(true);
    for (const l of mini.lemmas) {
      expect(mini.formsByLemma.get(l.id)?.length, l.lemma).toBeGreaterThan(0);
      expect(mini.senses.some((s) => s.lemmaId === l.id)).toBe(true);
      expect(l.freqRank).toBeDefined();
      expect(l.topForms.length, l.lemma).toBeGreaterThan(0);
      for (const t of l.topForms) expect(tagsOf(l.id, t.form) ?? [], t.form).toContain(t.tag);
    }
  });

  it('keeps forms and senses unique and linked to a lemma', () => {
    expect(unique(mini.forms.map((f) => `${f.lemmaId}|${f.form}`))).toBe(true);
    expect(unique(mini.senses.map((s) => `${s.lemmaId}|${s.ord}`))).toBe(true);
    for (const f of mini.forms) expect(mini.lemmaById.has(f.lemmaId)).toBe(true);
    for (const s of mini.senses) expect(mini.lemmaById.has(s.lemmaId)).toBe(true);
  });

  it('tags each form by its part of speech', () => {
    const shape: Record<string, RegExp> = {
      noun: /^[sp][1-7]$/,
      adj: /^[sp][1-7][mifn]$/,
      num: /^[sp][1-7][mifn]$/,
      verb: /^v:\S+$/,
    };
    for (const f of mini.forms) {
      const lemma = mini.lemmaById.get(f.lemmaId);
      const re = lemma && shape[lemma.pos];
      for (const tag of f.tags.split(' ')) {
        if (lemma?.pos === 'pron') expect(tag).toMatch(/^(?:x[1-7]|[sp][1-7][mifn])$/);
        else if (re) expect(tag, `${f.form} ${f.tags}`).toMatch(re);
        else expect(tag).toBe('');
      }
    }
  });

  it('gives each noun all fourteen slots, or seven for a word without one number', () => {
    for (const l of mini.lemmas.filter((x) => x.pos === 'noun')) {
      const tags = new Set(mini.formsByLemma.get(l.id)?.flatMap((f) => f.tags.split(' ')));
      const numbers = l.flags.pluralOnly
        ? ['p']
        : l.lemma === 'Bratislava' || l.lemma === 'človek'
          ? ['s']
          : ['s', 'p'];
      for (const n of numbers) {
        for (const c of '1234567') expect(tags.has(`${n}${c}`), `${l.lemma} ${n}${c}`).toBe(true);
      }
    }
  });

  it('links nouns and adjectives to a pattern of their part of speech and gender', () => {
    for (const l of mini.lemmas) {
      if (!l.pattern) continue;
      const p = mini.patternById.get(l.pattern);
      expect(p, l.lemma).toBeDefined();
      expect(p?.pos).toBe(l.pos);
      if (p?.gender) expect(p.gender).toBe(l.gender);
    }
  });

  it('gives verbs an aspect', () => {
    for (const l of mini.lemmas.filter((x) => x.pos === 'verb')) expect(l.aspect).toBeDefined();
  });
});

describe('patterns', () => {
  const SOFT: Record<string, string> = { ň: 'n', ť: 't', ď: 'd', ľ: 'l' };

  function join(stem: string, ending: string): string {
    const last = stem.at(-1) ?? '';
    if (SOFT[last] && /^[eií]/u.test(ending)) return stem.slice(0, -1) + SOFT[last] + ending;
    return stem + ending;
  }

  it('has the 14 noun and 2 adjective patterns, each with a model word', () => {
    expect(mini.patterns.filter((p) => p.pos === 'noun').map((p) => p.labelSk)).toEqual([
      'chlap',
      'hrdina',
      'dub',
      'stroj',
      'kuli',
      'žena',
      'ulica',
      'dlaň',
      'kosť',
      'gazdiná',
      'mesto',
      'srdce',
      'vysvedčenie',
      'dievča',
    ]);
    expect(mini.patterns.filter((p) => p.pos === 'adj').map((p) => p.id)).toEqual([
      'pekny',
      'cudzi',
    ]);
    for (const p of mini.patterns) {
      const model = mini.lemmaById.get(p.modelLemmaId ?? 0);
      expect(model?.lemma).toBe(p.labelSk);
      expect(model?.pattern).toBe(p.id);
    }
  });

  it('rebuilds every form of the model word from its stem and endings', () => {
    for (const p of mini.patterns) {
      const model = mini.lemmaById.get(p.modelLemmaId ?? 0);
      if (!model) throw new Error(p.id);
      const ending1 = p.pos === 'noun' ? (p.endings.s1 ?? '') : (p.endings.s1m ?? '');
      const stem = model.lemma.slice(0, model.lemma.length - ending1.length);
      const expected = new Set(Object.keys(p.endings));
      expect(expected.size).toBe(p.pos === 'noun' ? 14 : 56);
      for (const [tag, ending] of Object.entries(p.endings)) {
        const forms = (mini.formsByLemma.get(model.id) ?? []).filter((f) =>
          f.tags.split(' ').includes(tag),
        );
        expect(forms.length, `${p.id} ${tag}`).toBeGreaterThan(0);
        const built = join(stem, ending);
        if (ending === '' && tag.startsWith('p2')) {
          // A zero ending in the genitive plural lengthens or splits the stem: žien, miest, sŕdc.
          expect(forms.some((f) => f.form.length >= stem.length - 1)).toBe(true);
        } else {
          expect(
            forms.map((f) => f.form),
            `${p.id} ${tag}`,
          ).toContain(built);
        }
      }
    }
  });
});

describe('sentences', () => {
  it('have unique ids and tokens that are forms of their lemmas', () => {
    expect(unique(mini.sentences.map((s) => s.id))).toBe(true);
    for (const s of mini.sentences) {
      for (const t of s.tokens) {
        expect(t.e).toBeGreaterThan(t.s);
        expect(t.e).toBeLessThanOrEqual(s.textSk.length);
        if (t.lemmaId === undefined) continue;
        const form = s.textSk.slice(t.s, t.e);
        const tags = tagsOf(t.lemmaId, form) ?? tagsOf(t.lemmaId, form.toLowerCase());
        expect(tags, `${s.id} ${form}`).toBeDefined();
        expect(tags).toContain(t.tag ?? '');
      }
    }
  });

  it('link to their lemmas through tokens', () => {
    for (const s of mini.sentences) {
      expect(s.links.length).toBeGreaterThan(0);
      for (const l of s.links) {
        const t = s.tokens[l.tokenIndex];
        expect(t?.lemmaId).toBe(l.lemmaId);
        expect(t?.tag ?? '').toBe(l.tag);
        expect(s.textSk.slice(t?.s, t?.e)).toBe(l.form);
      }
    }
    const linked = new Set(mini.sentences.flatMap((s) => s.links.map((l) => l.lemmaId)));
    expect(linked.size).toBe(72);
  });

  it('say where they come from', () => {
    for (const s of mini.sentences) {
      if (s.source === 'tatoeba') expect(s.id).toBe(`tat-${s.sourceRef}`);
      else expect(s.id).toMatch(/^gen-[0-9a-f]{8}$/);
    }
  });
});

describe('triggers', () => {
  it('cover the twelve prepositions, pomáhať, päť and the question words', () => {
    const preps = new Set(
      mini.triggers.filter((t) => t.kind === 'preposition').map((t) => t.lemma),
    );
    expect([...preps].sort()).toEqual(
      ['do', 'z', 'od', 'bez', 'k', 'v', 'na', 'o', 'pri', 'po', 's', 'pre'].sort(),
    );
    expect(mini.triggerById.get('verb-pomahat')?.case).toBe('dat');
    expect(mini.triggerById.get('num-pat')?.case).toBe('gen');
    expect(mini.triggers.filter((t) => t.kind === 'question').length).toBeGreaterThanOrEqual(3);
  });

  it('link to their lemma and pair a two case word through a contrast group', () => {
    expect(unique(mini.triggers.map((t) => t.id))).toBe(true);
    for (const t of mini.triggers) {
      expect(mini.lemmaById.get(t.lemmaId ?? 0)?.lemma).toBe(t.lemma);
    }
    for (const word of ['v', 'na']) {
      const rows = mini.triggers.filter((t) => t.kind === 'preposition' && t.lemma === word);
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.contrastGroup === word)).toBe(true);
    }
  });
});

describe('exercises', () => {
  it('have unique ids and resolve every link', () => {
    expect(unique(mini.exercises.map((e) => e.id))).toBe(true);
    for (const e of mini.exercises) {
      if (e.triggerId) expect(mini.triggerById.has(e.triggerId), e.id).toBe(true);
      if (e.pattern) expect(mini.patternById.has(e.pattern), e.id).toBe(true);
      expect(mini.lessonById.has(e.lessonId ?? ''), e.id).toBe(true);
      for (const id of e.target.lemmaIds) expect(mini.lemmaById.has(id)).toBe(true);
    }
  });

  it('put the first answer in the gap', () => {
    for (const e of mini.exercises) {
      expect(e.sentenceSk.slice(e.target.start, e.target.end), e.id).toBe(e.target.answers[0]);
    }
  });

  it('accept only forms of the target lemma with the tag the exercise claims', () => {
    for (const e of mini.exercises) {
      for (const answer of e.target.answers) {
        const words = answer.split(' ');
        expect(words, `${e.id} ${answer}`).toHaveLength(e.target.lemmaIds.length);
        words.forEach((word, i) => {
          const lemmaId = e.target.lemmaIds[i] ?? 0;
          const tags = tagsOf(lemmaId, word) ?? tagsOf(lemmaId, word.toLowerCase());
          expect(tags, `${e.id}: ${word} is not a form of lemma ${lemmaId}`).toBeDefined();
          expect(tags, `${e.id}: ${word}`).toContain(expectedTag(e, lemmaId));
        });
      }
    }
  });

  it('claim the gender and pattern of the target noun', () => {
    for (const e of mini.exercises) {
      const head = mini.lemmaById.get(e.target.lemmaIds.at(-1) ?? 0);
      if (head?.pos !== 'noun') continue;
      expect(head.gender, e.id).toBe(e.gender);
      if (head.pattern) expect(e.pattern, e.id).toBe(head.pattern);
    }
  });

  it('give the cue as the base forms of the target lemmas', () => {
    for (const e of mini.exercises) {
      const words = e.target.cue.split(' ');
      expect(words).toHaveLength(e.target.lemmaIds.length);
      words.forEach((word, i) => {
        const tags = tagsOf(e.target.lemmaIds[i] ?? 0, word) ?? [];
        expect(
          tags.some((t) => t === '' || /^[spx]1/.test(t)),
          `${e.id} ${word}`,
        ).toBe(true);
      });
    }
  });

  it('offer one right option, and real forms of other cases as wrong ones', () => {
    for (const e of mini.exercises) {
      if (e.kind === 'cloze') {
        expect(e.options).toBeUndefined();
        continue;
      }
      const options = e.options ?? [];
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options.filter((o) => o.correct)).toHaveLength(1);
      if (e.kind !== 'choice_form') continue;
      const lemmaId = e.target.lemmaIds[0] ?? 0;
      for (const o of options) {
        if (o.correct) {
          expect(e.target.answers).toContain(o.text);
        } else {
          const tags = tagsOf(lemmaId, o.text);
          expect(tags, `${e.id} ${o.text}`).toBeDefined();
          expect(tags).not.toContain(expectedTag(e, lemmaId));
        }
      }
    }
  });
});

describe('lessons', () => {
  it('are the nine lessons of the course, in order', () => {
    expect(mini.lessons.map((l) => l.id)).toEqual([
      'acc-sg',
      'loc-sg',
      'gen-sg',
      'ins-sg',
      'dat-pron',
      'nom-acc-pl',
      'loc-ins-dat-pl',
      'gen-pl',
      'mixed',
    ]);
    expect(mini.lessons.map((l) => l.ord)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('give acc-sg and loc-sg all five steps, and cover each of their buckets in every step', () => {
    for (const id of ['acc-sg', 'loc-sg']) {
      const lesson = mini.lessonById.get(id);
      expect(lesson?.steps.map((s) => s.kind)).toEqual([
        'explain',
        'triggers',
        'comprehension',
        'production',
        'checkpoint',
      ]);
      for (const step of lesson?.steps ?? []) {
        if (!('exerciseIds' in step.content)) continue;
        const exs = step.content.exerciseIds.map((x) => mini.exerciseById.get(x));
        for (const b of lesson?.focus.buckets ?? []) {
          expect(
            exs.some((x) => x?.case === b.case && x.number === b.number && x.gender === b.gender),
            `${id} ${step.kind} ${b.gender}`,
          ).toBe(true);
        }
      }
    }
  });

  it('resolve every step, and place each exercise in a step of its own lesson', () => {
    const placed = new Set<string>();
    for (const lesson of mini.lessons) {
      expect(lesson.steps.map((s) => s.ord)).toEqual(lesson.steps.map((_, i) => i));
      for (const t of lesson.focus.triggerIds) expect(mini.triggerById.has(t)).toBe(true);
      for (const step of lesson.steps) {
        const c = step.content;
        if (c.kind === 'triggers') {
          for (const t of c.triggerIds) expect(mini.triggerById.has(t), t).toBe(true);
        } else if (c.kind === 'explain') {
          for (const x of c.examples) expect(x.highlight.end).toBeLessThanOrEqual(x.sk.length);
        } else {
          for (const x of c.exerciseIds) {
            expect(mini.exerciseById.get(x)?.lessonId, x).toBe(lesson.id);
            placed.add(x);
          }
        }
      }
    }
    expect(placed.size).toBe(mini.exercises.length);
  });

  it('give every lesson two or more typed gaps, so placement works', () => {
    for (const lesson of mini.lessons) {
      const typed = mini.exercises.filter((e) => e.lessonId === lesson.id && e.kind === 'cloze');
      expect(typed.length, lesson.id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('scenarios and library', () => {
  it('resolve their triggers', () => {
    for (const s of mini.scenarios) {
      for (const t of s.targetTriggers) expect(mini.triggerById.has(t), t).toBe(true);
    }
  });

  it('analyse the library text with real forms and counted lemmas', () => {
    const text = mini.library[0];
    if (!text?.analysis) throw new Error('no analysis');
    const counts: Record<string, number> = {};
    for (const s of text.analysis.sentences) {
      for (const t of s.tokens) {
        expect(t.s).toBeGreaterThanOrEqual(s.s);
        expect(t.e).toBeLessThanOrEqual(s.e);
        if (t.l === undefined) continue;
        expect(text.analysis.lemmas[String(t.l)]).toBeDefined();
        const form = text.body.slice(t.s, t.e);
        const tags = tagsOf(t.l, form) ?? tagsOf(t.l, form.toLowerCase());
        expect(tags, form).toContain(t.tag ?? '');
        counts[String(t.l)] = (counts[String(t.l)] ?? 0) + 1;
        if (t.trig) {
          expect(mini.triggerById.has(t.trig.id ?? '')).toBe(true);
          expect(s.tokens[t.trig.i ?? -1]?.t).toBe('word');
        }
      }
    }
    expect(text.lemmaCounts).toEqual(counts);
  });
});

describe('alignment with the contract examples', () => {
  type Item = {
    exerciseId: string;
    sentenceSk: string;
    answers: string[];
    features: { case: string; number: string; gender: string };
    formMap: Record<string, string[]>;
    trigger?: { id: string };
  };
  const items: Item[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if ('exerciseId' in v && 'formMap' in v) items.push(v as Item);
      Object.values(v).forEach(walk);
    }
  };
  walk(examples);

  it('holds every exercise the examples use, with the same sentence and features', () => {
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const e = mini.exerciseById.get(item.exerciseId);
      expect(e, item.exerciseId).toBeDefined();
      expect(e?.sentenceSk).toBe(item.sentenceSk);
      expect(e?.target.answers).toEqual(item.answers);
      expect([e?.case, e?.number, e?.gender]).toEqual([
        item.features.case,
        item.features.number,
        item.features.gender,
      ]);
      expect(e?.triggerId).toBe(item.trigger?.id);
      const map = miniFormMap(e?.target.lemmaIds[0] ?? 0);
      for (const [form, tags] of Object.entries(item.formMap)) {
        for (const tag of tags) expect(map[form] ?? [], `${form} ${tag}`).toContain(tag);
      }
    }
  });

  it('holds the trigger and pattern ids the examples use', () => {
    for (const t of ['prep-do', 'prep-v-loc', 'prep-pre', 'prep-s-ins', 'verb-pomahat']) {
      expect(mini.triggerById.has(t), t).toBe(true);
    }
    for (const p of ['mesto', 'zena', 'chlap']) expect(mini.patternById.has(p), p).toBe(true);
    expect(mini.scenarios.map((s) => s.id).sort()).toEqual(['scn-city-walk', 'scn-coach-loc']);
    expect(mini.library[0]?.id).toBe('lib-001');
  });
});
