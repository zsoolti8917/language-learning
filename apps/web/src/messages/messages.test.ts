import { describe, expect, it } from 'vitest';
import { defineMessages, en, format, t } from './index';

describe('messages', () => {
  it('looks up dotted keys and fills variables', () => {
    expect(t('tabs.today')).toBe('Today');
    expect(t('placeholder.param', { name: 'id', value: 3 })).toBe('id: 3');
    expect(format('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('returns the key for a missing message', () => {
    expect(t('nope.nothing' as never)).toBe('nope.nothing');
  });

  it('gives each feature its own typed messages', () => {
    const m = defineMessages({ due: '{count} due', nested: { title: 'Deck' } });
    expect(m.t('due', { count: 4 })).toBe('4 due');
    expect(m.t('nested.title')).toBe('Deck');
  });

  it('has a title for every tab', () => {
    expect(Object.keys(en.tabs)).toEqual(['label', 'today', 'review', 'read', 'cases', 'tutor']);
  });
});
