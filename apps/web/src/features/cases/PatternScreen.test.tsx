import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../../messages';
import { renderRoute } from '../../test/utils';
import { m } from './messages';
import { useCasesMock } from './test-helpers';

useCasesMock();

describe('pattern screen', () => {
  it('shows the table of endings with the model and the everyday word', async () => {
    renderRoute('/cases/pattern/zena');
    expect(
      await screen.findByRole('heading', { name: en.screens.pattern, level: 1 }),
    ).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'žena', level: 2 })).toBeVisible();
    expect(screen.getByTestId('everyday')).toHaveTextContent('kniha');
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    const text = rows.map((r) =>
      within(r)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    );
    // Rows in school order; the genitive plural has no ending.
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'Nominative',
      'Genitive',
      'Dative',
      'Accusative',
      'Vocative',
      'Locative',
      'Instrumental',
    ]);
    expect(text[1]).toEqual(['-y', `—${m.t('pattern.noEnding')}`]);
    expect(text[2]).toEqual(['-e', '-ám']);
    expect(screen.getByText('Feminine nouns ending in -a after a hard consonant.')).toBeVisible();
  });

  it('shows an adjective pattern by gender', async () => {
    renderRoute('/cases/pattern/pekny');
    expect(await screen.findByRole('heading', { name: 'pekný', level: 2 })).toBeVisible();
    const [sg] = screen.getAllByRole('table');
    expect(
      within(sg as HTMLElement)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Case', 'm. anim.', 'm. inan.', 'fem.', 'neut.']);
  });

  it('says so when the pattern does not exist', async () => {
    renderRoute('/cases/pattern/nope');
    expect(await screen.findByText(m.t('pattern.notFound'))).toBeVisible();
  });
});
