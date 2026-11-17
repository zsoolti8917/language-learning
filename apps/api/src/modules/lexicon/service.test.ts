// Pure logic of the lexicon module: candidate order, form tables, gloss request and answer,
// and the cache.
import { PROMPTS } from '@app/ai';
import type { FormCandidate, Lemma } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildFormTables,
  GlossAnswerSchema,
  glossesToStore,
  glossRequest,
  LruCache,
  matchTier,
  orderCandidates,
  toParadigm,
} from './service';

const cand = (lemmaId: number, form: string, freqRank: number | null): FormCandidate => ({
  lemmaId,
  lemma: form,
  pos: 'noun',
  form,
  readings: [],
  freqRank,
});

describe('candidate order', () => {
  it('ranks exact spelling, then capitals, then accents', () => {
    expect(matchTier('mesto', 'mesto')).toBe(0);
    expect(matchTier('mesto', 'Mesto')).toBe(1);
    expect(matchTier('Bratislava', 'bratislava')).toBe(1);
    expect(matchTier('mestá', 'Mesta')).toBe(2);
    // A decomposed accent from a phone keyboard is the same spelling.
    expect(matchTier('mestá', 'mestá')).toBe(0);
  });

  it('orders by tier, then frequency, then lemma id', () => {
    const list = [cand(3, 'má', 9), cand(1, 'ma', 40), cand(2, 'ma', 4), cand(4, 'Ma', null)];
    expect(orderCandidates(list, 'ma').map((c) => c.lemmaId)).toEqual([2, 1, 4, 3]);
    expect(orderCandidates(list, 'Ma').map((c) => c.lemmaId)).toEqual([4, 2, 1, 3]);
    expect(orderCandidates(list, 'má').map((c) => c.lemmaId)).toEqual([3, 2, 1, 4]);
  });
});

describe('form tables', () => {
  it('lists every variant of a slot and drops empty rows', () => {
    const paradigm = toParadigm({ id: 27, pos: 'noun', gender: 'm_anim' }, [
      { form: 'človekovi', tags: 's3' },
      { form: 'človek', tags: 's1' },
      { form: 'človeku', tags: 's3 s6' },
    ]);
    expect(paradigm.forms.map((f) => f.form)).toEqual(['človek', 'človekovi', 'človeku']);
    const [t] = buildFormTables(paradigm);
    expect(t?.columns).toEqual(['sg']);
    expect(t?.rows.map((r) => r.case)).toEqual(['nom', 'dat', 'loc']);
    expect(t?.rows[1]?.cells.sg).toEqual(['človekovi', 'človeku']);
  });

  it('ignores verb and empty tags', () => {
    const paradigm = toParadigm({ id: 61, pos: 'verb', gender: null }, [
      { form: 'mať', tags: 'v:Infa+' },
      { form: 'a', tags: '' },
    ]);
    expect(paradigm.forms.map((f) => [f.form, f.readings])).toEqual([
      ['a', []],
      ['mať', [{ tag: 'v:Infa+' }]],
    ]);
    expect(buildFormTables(paradigm)).toEqual([]);
  });
});

describe('reader.gloss', () => {
  const lemma: Lemma = {
    id: 65,
    key: 'pomáhať|verb|-|1',
    lemma: 'pomáhať',
    pos: 'verb',
    gender: null,
    pattern: null,
    aspect: 'ipf',
    freqRank: 56,
    topForms: [],
    flags: {},
  };

  it('builds one request from the prompt folder', () => {
    const req = glossRequest([lemma], '00000000-0000-7000-8000-000000000001');
    expect(req.route).toBe('reader.gloss');
    expect(PROMPTS['reader.gloss'].versions[1]?.placeholder).toBeUndefined();
    expect(req.system.at(-1)?.cache).toBe(true);
    expect(req.system.map((b) => b.text).join('')).toContain('"glosses"');
    expect(JSON.parse(req.messages[0]?.content ?? '')).toEqual({
      lemmas: [{ lemmaId: 65, lemma: 'pomáhať', pos: 'verb', aspect: 'ipf' }],
    });
  });

  it('keeps asked lemmas only, once, with at most three distinct trimmed glosses', () => {
    const answer = GlossAnswerSchema.parse({
      glosses: [
        { lemmaId: 65, glosses: ['to help ', 'to  help', 'to assist', 'to aid', 'to support'] },
        { lemmaId: 65, glosses: ['second entry'] },
        { lemmaId: 7, glosses: ['not asked'] },
      ],
    });
    expect(glossesToStore(answer, new Set([65]))).toEqual(
      new Map([[65, ['to help', 'to assist', 'to aid']]]),
    );
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1);
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.size).toBe(2);
    c.clear();
    expect(c.size).toBe(0);
    const off = new LruCache<string, number>(0);
    off.set('a', 1);
    expect(off.get('a')).toBeUndefined();
  });
});
