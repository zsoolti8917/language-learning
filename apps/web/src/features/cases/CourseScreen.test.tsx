import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { en } from '../../messages';
import { mockNetworkError, renderRoute, server } from '../../test/utils';
import { m } from './messages';
import { useCasesMock } from './test-helpers';

useCasesMock();

describe('course map', () => {
  it('lists the nine lessons with their status', async () => {
    renderRoute('/cases');
    expect(await screen.findByRole('heading', { name: en.screens.course, level: 1 })).toBeVisible();
    const lessons = await screen.findAllByRole('link', { name: /^Lesson \d/ });
    expect(lessons).toHaveLength(9);
    expect(lessons[0]).toHaveAttribute('href', '/cases/lesson/acc-sg');
    expect(lessons[0]).toHaveTextContent('Completed · 7 of 8');
    expect(lessons[1]).toHaveTextContent('In progress');
    expect(lessons[4]).toHaveTextContent('Locked');
    expect(lessons[8]).toHaveTextContent('All cases together');
    expect(screen.getByRole('link', { name: m.t('course.train') })).toHaveAttribute(
      'href',
      '/cases/train',
    );
    expect(screen.getByRole('link', { name: 'žena' })).toHaveAttribute(
      'href',
      '/cases/pattern/zena',
    );
  });

  it('shows each mastery level with a text label as well as a colour', async () => {
    renderRoute('/cases');
    const cell = (c: string) =>
      document.querySelector(`[data-cell="${c}"]`) as HTMLButtonElement | null;
    await screen.findByRole('heading', { name: m.t('course.mastery') });
    // acc sg: f 0.91 (30), m_anim 0.78 (22), m_inan 0.88 (12) → 0.86, strong overall.
    const levels: [string, string][] = [
      ['acc.sg', 'Strong'],
      ['ins.sg', 'Fair'],
      ['loc.sg', 'Weak'],
      ['gen.sg', 'Weak'],
      ['dat.sg', 'Not yet'],
      ['ins.pl', 'Not yet'],
    ];
    for (const [key, label] of levels) {
      const button = cell(key);
      expect(button).not.toBeNull();
      expect(button).toHaveTextContent(label);
      expect(button?.className).toMatch(/bg-(surface-2|wrong-soft|close-soft|correct-soft)/);
    }
    expect(cell('acc.sg')).toHaveAccessibleName('Accusative singular: Strong');
    // Every level appears as a word in the grid.
    for (const label of ['Strong', 'Fair', 'Weak', 'Not yet']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('opens a cell into its genders', async () => {
    const user = userEvent.setup();
    renderRoute('/cases');
    await screen.findByRole('heading', { name: m.t('course.mastery') });
    await user.click(screen.getByRole('button', { name: 'Accusative singular: Strong' }));
    const sheet = await screen.findByRole('dialog', { name: 'Accusative singular' });
    const rows = within(sheet).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Masculine animate22 attempts◇Fair',
      'Masculine inanimate12 attempts★Strong',
      'Feminine30 attempts★Strong',
      'Neuter0 attempts○Not yet',
    ]);
  });

  it('shows the offline state when the course cannot load', async () => {
    server.use(mockNetworkError('declension.course'));
    renderRoute('/cases');
    expect(await screen.findByText(m.t('state.offline'))).toBeVisible();
    // The trainer and the pattern tables stay reachable.
    expect(screen.getByRole('link', { name: m.t('course.train') })).toBeVisible();
  });
});
