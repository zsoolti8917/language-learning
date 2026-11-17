// The shared suite of DictionaryPort. The mini stand in and B2's real port both pass it.
import { SenseSchema } from '@app/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DictionaryPort, PortContext } from '../../ports';
import { createSuiteEnv, type SharedSuiteEnv, type SuiteEnv } from './context';

export function runDictionarySuite(
  name: string,
  make: (ctx: PortContext) => DictionaryPort | Promise<DictionaryPort>,
  shared?: SharedSuiteEnv,
): void {
  describe(`DictionaryPort suite: ${name}`, () => {
    let env: SuiteEnv;
    let port: DictionaryPort;
    beforeAll(async () => {
      env = shared ? shared() : await createSuiteEnv();
      port = await make(env.ctx);
    });
    afterAll(async () => {
      if (!shared) await env.close();
    });

    it('getSenses returns the senses of every lemma in order', async () => {
      const map = await port.getSenses([20, 12]);
      for (const id of [20, 12]) {
        const senses = map.get(id) ?? [];
        expect(senses.length).toBeGreaterThan(0);
        for (const s of senses) SenseSchema.parse(s);
        const ords = senses.map((s) => s.ord);
        expect(ords).toEqual([...ords].sort((a, b) => a - b));
      }
      expect((await port.getSenses([999_999])).get(999_999) ?? []).toEqual([]);
    });

    it('ensureGlosses returns stored glosses without asking the model', async () => {
      const before = env.gateway.calls.length;
      const map = await port.ensureGlosses([20, 12], { sentenceSk: 'Idem do mesta.' });
      expect(map.get(20)?.length).toBeGreaterThan(0);
      expect(map.get(12)?.length).toBeGreaterThan(0);
      expect(env.gateway.calls.length).toBe(before);
    });
  });
}
