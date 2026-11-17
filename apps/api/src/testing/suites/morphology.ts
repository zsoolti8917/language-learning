// The shared suite of MorphologyPort. The mini stand in and B2's real port both pass it.
import { FormCandidateSchema, foldAscii, LemmaSchema, ParadigmSchema } from '@app/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MorphologyPort, PortContext } from '../../ports';
import { createSuiteEnv, type SharedSuiteEnv, type SuiteEnv } from './context';

const MESTO = 20;
const LUDIA = 28;

export function runMorphologySuite(
  name: string,
  make: (ctx: PortContext) => MorphologyPort | Promise<MorphologyPort>,
  shared?: SharedSuiteEnv,
): void {
  describe(`MorphologyPort suite: ${name}`, () => {
    let env: SuiteEnv;
    let port: MorphologyPort;
    beforeAll(async () => {
      env = shared ? shared() : await createSuiteEnv();
      port = await make(env.ctx);
    });
    afterAll(async () => {
      if (!shared) await env.close();
    });

    it('lookupForms has a key per input form, the folded form, and valid candidates', async () => {
      const inputs = ['mesta', 'mestá', 'Mesto', 'Ľudia', 'xyzzy'];
      const map = await port.lookupForms(inputs);
      for (const f of inputs) expect(map.has(foldAscii(f)), f).toBe(true);
      for (const list of map.values()) for (const c of list) FormCandidateSchema.parse(c);
      expect(map.get('xyzzy')).toEqual([]);
    });

    it('tells mesta and mestá apart by form and tags', async () => {
      const list = (await port.lookupForms(['mestá'])).get('mesta') ?? [];
      const plural = list.find((c) => c.form === 'mestá' && c.lemmaId === MESTO);
      const gen = list.find((c) => c.form === 'mesta' && c.lemmaId === MESTO);
      expect(plural?.readings.map((r) => r.tag).sort()).toEqual(['p1', 'p4', 'p5']);
      expect(gen?.readings.map((r) => r.tag)).toEqual(['s2']);
      expect(gen?.readings[0]).toMatchObject({ case: 'gen', number: 'sg' });
      // Exact matches come first.
      expect(list[0]?.form).toBe('mestá');
    });

    it('finds the lower case lemma of a capitalised word, and Ľudia', async () => {
      const map = await port.lookupForms(['Mesto', 'Ľudia']);
      expect(map.get('mesto')?.some((c) => c.lemmaId === MESTO)).toBe(true);
      expect(map.get('ludia')?.some((c) => c.lemmaId === LUDIA && c.form === 'ľudia')).toBe(true);
    });

    it('getParadigm returns every form of a lemma with readings', async () => {
      const p = ParadigmSchema.parse(await port.getParadigm(MESTO));
      const tags = p.forms.flatMap((f) => f.readings.map((r) => r.tag));
      for (const t of ['s1', 's2', 's3', 's4', 's6', 's7', 'p1', 'p2', 'p3', 'p6', 'p7'])
        expect(tags).toContain(t);
      expect(p.forms.find((f) => f.form === 'meste')?.readings[0]?.case).toBe('loc');
    });

    it('verifyForm confirms a form with the claimed case and refuses others', async () => {
      const ok = await port.verifyForm('meste', { lemmaId: MESTO, case: 'loc' });
      expect(ok.length).toBeGreaterThan(0);
      expect(ok.every((c) => c.readings.every((r) => r.case === 'loc'))).toBe(true);
      expect(await port.verifyForm('mesto', { lemmaId: MESTO, case: 'loc' })).toEqual([]);
      expect(await port.verifyForm('mestoo', { lemmaId: MESTO })).toEqual([]);
      expect(await port.verifyForm('mestá', { lemmaId: MESTO, number: 'sg' })).toEqual([]);
    });

    it('getLemma and findLemma', async () => {
      const l = LemmaSchema.parse(await port.getLemma(MESTO));
      expect(l).toMatchObject({ id: MESTO, lemma: 'mesto', pos: 'noun', gender: 'n' });
      expect(await port.getLemma(999_999)).toBeNull();
      expect((await port.findLemma('Mesto')).map((x) => x.id)).toContain(MESTO);
      expect(await port.findLemma('mesto', 'verb')).toEqual([]);
    });
  });
}
