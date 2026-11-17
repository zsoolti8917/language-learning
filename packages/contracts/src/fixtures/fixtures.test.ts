import { describe, expect, it } from 'vitest';
import { normalizeAnswer } from '../text';
import { examples } from './examples';
import { MINI_LEMMAS } from './mini-lemmas';
import { TUTOR_STREAM_BUDGET_ERROR, TUTOR_STREAM_EXAMPLE } from './tutor-stream';

type Obj = Record<string, unknown>;

/** Every object anywhere inside the examples, with its path. */
function* walk(v: unknown, path = ''): Generator<[Obj, string]> {
  if (Array.isArray(v)) {
    for (const [i, x] of v.entries()) yield* walk(x, `${path}[${i}]`);
  } else if (v && typeof v === 'object') {
    yield [v as Obj, path];
    for (const [k, x] of Object.entries(v)) yield* walk(x, `${path}.${k}`);
  }
}

const all = [...walk(examples)];
const lemmaName = MINI_LEMMAS as Record<number, string>;

function sliceOf(text: unknown, span: unknown): string {
  const { start, end } = span as { start: number; end: number };
  return (text as string).slice(start, end);
}

describe('mini dataset words', () => {
  it('lists the 72 lemmas of the F9 specification', () => {
    const ids = Object.keys(MINI_LEMMAS).map(Number);
    expect(ids).toEqual(Array.from({ length: 72 }, (_, i) => i + 1));
    expect(MINI_LEMMAS[20]).toBe('mesto');
    expect(MINI_LEMMAS[31]).toBe('Bratislava');
    expect(MINI_LEMMAS[72]).toBe('kde');
  });

  it('uses only lemma ids of the mini dataset', () => {
    const used: [string, unknown][] = [];
    for (const [o, path] of all) {
      for (const key of ['lemmaId', 'l'])
        if (o[key] !== undefined && o[key] !== null) used.push([`${path}.${key}`, o[key]]);
      if (Array.isArray(o.lemmaIds)) for (const id of o.lemmaIds) used.push([path, id]);
      if (path.endsWith('.lemmas') || path.endsWith('.lemmaStatus'))
        for (const k of Object.keys(o)) used.push([`${path}.${k}`, Number(k)]);
    }
    expect(used.length).toBeGreaterThan(20);
    for (const [path, id] of used) expect(lemmaName[id as number], path).toBeDefined();
  });

  it('pairs each lemma id with its own lemma', () => {
    let checked = 0;
    for (const [o, path] of all) {
      const id = (o.lemmaId ?? o.id) as number;
      if (typeof o.lemma === 'string' && typeof id === 'number') {
        expect(o.lemma, path).toBe(lemmaName[id]);
        checked++;
      }
    }
    // Text analyses key lemmas by id.
    for (const [o, path] of all) {
      if (!path.endsWith('.lemmas')) continue;
      for (const [k, v] of Object.entries(o)) {
        expect((v as Obj).lemma, `${path}.${k}`).toBe(lemmaName[Number(k)]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('consistency of the examples', () => {
  it('puts the first answer under every blank', () => {
    let checked = 0;
    for (const [o, path] of all) {
      const sentence = o.sentenceSk ?? (o.prompt as Obj | undefined)?.sentenceSk;
      const blank = o.blank ?? (o.prompt as Obj | undefined)?.blank;
      const answer = Array.isArray(o.answers) ? o.answers[0] : o.answer;
      if (typeof sentence === 'string' && blank && typeof answer === 'string') {
        expect(sliceOf(sentence, blank), path).toBe(answer);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('keeps placement case items free of answers', () => {
    for (const [o, path] of all) {
      if (o.kind === 'case' && 'itemId' in o) {
        expect(sliceOf(o.sentenceSk, o.blank), path).toBe('___');
        expect(o).not.toHaveProperty('answers');
      }
    }
  });

  it('makes the first answer a key of the form map, with one correct option', () => {
    for (const [o, path] of all) {
      if (!Array.isArray(o.answers) || !o.formMap) continue;
      expect(Object.keys(o.formMap as Obj), path).toContain(normalizeAnswer(o.answers[0]));
      if (Array.isArray(o.options)) {
        const right = (o.options as { text: string; correct: boolean }[]).filter((x) => x.correct);
        expect(
          right.map((x) => x.text),
          path,
        ).toEqual([o.answers[0]]);
      }
    }
  });

  it('points highlights, spans and analysis tokens at real text', () => {
    for (const [o, path] of all) {
      if (typeof o.sk === 'string' && o.highlight) {
        expect(sliceOf(o.sk, o.highlight).length, path).toBeGreaterThan(0);
      }
      if (typeof o.textSk === 'string' && typeof o.form === 'string' && o.span) {
        expect(sliceOf(o.textSk, o.span), path).toBe(o.form);
      }
    }
    const text = examples['texts.get'].ok[0].response.body;
    if (!text?.analysis) throw new Error('texts.get example has no analysis');
    for (const s of text.analysis.sentences) {
      for (const t of s.tokens) {
        expect(t.s).toBeGreaterThanOrEqual(s.s);
        expect(t.e).toBeLessThanOrEqual(s.e);
        const piece = text.body.slice(t.s, t.e);
        expect(piece.trim()).toBe(piece);
        if (t.l) {
          expect(piece.length).toBeGreaterThan(0);
        }
      }
    }
    for (const p of text.phrases) {
      if (p.span) expect(text.body.slice(p.span.start, p.span.end)).toBe(p.textSk);
    }
  });

  it('marks the tutor error at the given form', () => {
    const msg = examples['tutor.sendMessage'].ok[0].request.body?.content ?? '';
    const first = TUTOR_STREAM_EXAMPLE[0];
    if (first?.event !== 'analysis') throw new Error('stream must start with analysis');
    for (const e of first.data.errors) expect(msg.slice(e.start, e.end)).toBe(e.given);
  });
});

describe('tutor stream example', () => {
  it('sends one analysis, then deltas, then one done', () => {
    const order = TUTOR_STREAM_EXAMPLE.map((e) => e.event);
    expect(order[0]).toBe('analysis');
    expect(order.at(-1)).toBe('done');
    expect(order.slice(1, -1).every((e) => e === 'delta')).toBe(true);
    expect(order.slice(1, -1).length).toBeGreaterThan(0);
  });

  it('joins the deltas into the stored tutor message', () => {
    const text = TUTOR_STREAM_EXAMPLE.flatMap((e) =>
      e.event === 'delta' ? [e.data.text] : [],
    ).join('');
    const done = TUTOR_STREAM_EXAMPLE.at(-1);
    if (done?.event !== 'done') throw new Error('no done event');
    expect(text).toBe(done.data.tutorMessage.content);
  });

  it('carries no expected form for a prompted error', () => {
    const first = TUTOR_STREAM_EXAMPLE[0];
    if (first?.event !== 'analysis') throw new Error('stream must start with analysis');
    for (const e of first.data.errors)
      if (e.status === 'prompted') expect(e.expected).toBeUndefined();
  });

  it('can end with a single error event', () => {
    expect(TUTOR_STREAM_BUDGET_ERROR.map((e) => e.event)).toEqual(['error']);
  });
});
