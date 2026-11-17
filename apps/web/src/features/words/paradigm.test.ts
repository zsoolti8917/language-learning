import { examples, type LemmaDetail } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { mockLemmaDetail } from './mocks';
import { buildParadigm } from './paradigm';

const MESTO = examples['lemmas.get'].ok[0]?.response.body as LemmaDetail;

describe('buildParadigm', () => {
  it('lays mesto out as six cases by two numbers with the top forms marked', () => {
    const table = buildParadigm(MESTO.forms, MESTO.lemma.topForms);
    expect(table.kind).toBe('number');
    expect(table.rows.map((r) => r.case)).toEqual(['nom', 'gen', 'dat', 'acc', 'loc', 'ins']);
    const cells = table.rows.map((r) => r.cells.map((c) => c.forms.map((f) => f.form).join(',')));
    expect(cells).toEqual([
      ['mesto', 'mestá'],
      ['mesta', 'miest'],
      ['mestu', 'mestám'],
      ['mesto', 'mestá'],
      ['meste', 'mestách'],
      ['mestom', 'mestami'],
    ]);
    const top = table.rows.flatMap((r) =>
      r.cells.flatMap((c) => c.forms.filter((f) => f.top).map((f) => `${r.case}:${f.form}`)),
    );
    // mesto s1 is top, but its accusative reading (s4) is not.
    expect(top).toEqual(['nom:mesto', 'gen:mesta', 'loc:meste']);
    // The vocative equals the nominative, so nothing extra is listed.
    expect(table.vocative).toEqual([]);
    expect(table.other).toEqual([]);
  });

  it('lists a vocative that differs from the nominative', () => {
    const chlap = mockLemmaDetail(1) as LemmaDetail;
    expect(chlap.lemma.lemma).toBe('chlap');
    expect(buildParadigm(chlap.forms, chlap.lemma.topForms).vocative).toEqual(['chlape']);
  });

  it('puts adjective forms of every gender in one cell', () => {
    const pekny = mockLemmaDetail(32) as LemmaDetail;
    const table = buildParadigm(pekny.forms, pekny.lemma.topForms);
    const nomSg = table.rows[0]?.cells[0]?.forms.map((f) => f.form);
    expect(nomSg).toEqual(expect.arrayContaining(['pekný', 'pekná', 'pekné']));
  });

  it('shows verbs as a list of forms without a table', () => {
    const pomahat = mockLemmaDetail(65) as LemmaDetail;
    const table = buildParadigm(pomahat.forms, pomahat.lemma.topForms);
    expect(table.rows).toEqual([]);
    expect(table.other).toContain('pomáhať');
  });
});
