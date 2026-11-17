import './test/setup';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type TextToken, TokenText } from './TokenText';

// "Idem do mesta, ty?" with offsets as the tokenizer gives them.
const TEXT = 'Idem do mesta, ty?';
const TOKENS: TextToken[] = [
  { start: 0, end: 4, status: 'known' },
  { start: 5, end: 7, status: 'learning' },
  { start: 8, end: 13, status: 'unknown' },
  { start: 13, end: 14 },
  { start: 15, end: 17, status: 'ignored' },
  { start: 17, end: 18, status: null },
];

describe('TokenText', () => {
  it('renders the text exactly, in Slovak', () => {
    const { container } = render(<TokenText text={TEXT} tokens={TOKENS} />);
    const p = container.querySelector('p');
    expect(p).toHaveTextContent(TEXT, { normalizeWhitespace: false });
    expect(p?.textContent).toBe(TEXT);
    expect(p).toHaveAttribute('lang', 'sk');
  });

  it('keeps tokens out of order and skips overlaps', () => {
    const tokens: TextToken[] = [
      { start: 3, end: 5, status: 'known' },
      { start: 0, end: 2, status: 'unknown' },
      { start: 1, end: 4, status: 'known' },
    ];
    const { container } = render(<TokenText text="ab cd" tokens={tokens} />);
    expect(container.textContent).toBe('ab cd');
    expect(container.querySelectorAll('[data-status]')).toHaveLength(2);
  });

  it('marks each status, with a different underline for unknown and learning', () => {
    const { container } = render(<TokenText text={TEXT} tokens={TOKENS} />);
    const byStatus = (s: string) => container.querySelector(`[data-status="${s}"]`);
    expect(byStatus('unknown')?.className).toContain('bg-token-unknown');
    expect(byStatus('unknown')?.className).toContain('underline');
    expect(byStatus('learning')?.className).toContain('bg-token-learning');
    expect(byStatus('learning')?.className).toContain('decoration-dotted');
    expect(byStatus('known')?.className).not.toContain('bg-token');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('makes words with a status tappable, not punctuation', async () => {
    const user = userEvent.setup();
    const onTap = vi.fn();
    render(<TokenText text={TEXT} tokens={TOKENS} onTokenTap={onTap} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Idem', 'do', 'mesta', 'ty']);
    await user.click(screen.getByRole('button', { name: 'mesta, new word' }));
    expect(onTap).toHaveBeenCalledWith(2, TOKENS[2]);
    expect(screen.getByRole('button', { name: 'do, learning' })).toBeInTheDocument();
    // Every word button has the 44 px hit area.
    for (const b of buttons) expect(b.className).toContain('before:h-tap');
  });

  it('has one tab stop and moves between words with the arrow keys', async () => {
    const user = userEvent.setup();
    const onTap = vi.fn();
    render(
      <>
        <button type="button">before</button>
        <TokenText text={TEXT} tokens={TOKENS} onTokenTap={onTap} />
        <button type="button">after</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'before' }));
    await user.tab();
    expect(document.activeElement).toHaveTextContent('Idem');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveTextContent('do');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveTextContent('mesta');
    await user.keyboard('{Enter}');
    expect(onTap).toHaveBeenLastCalledWith(2, TOKENS[2]);
    await user.keyboard('{End}');
    expect(document.activeElement).toHaveTextContent('ty');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveTextContent('ty');
    await user.keyboard('{Home}{ArrowLeft}');
    expect(document.activeElement).toHaveTextContent('Idem');
    await user.keyboard(' ');
    expect(onTap).toHaveBeenLastCalledWith(0, TOKENS[0]);
    await user.tab();
    expect(document.activeElement).toHaveTextContent('after');
    // Coming back lands on the last active word.
    await user.tab({ shift: true });
    expect(document.activeElement).toHaveTextContent('Idem');
  });

  it('shows selection with aria-pressed', () => {
    render(<TokenText text={TEXT} tokens={TOKENS} onTokenTap={() => {}} selected={[1, 2]} />);
    expect(screen.getByRole('button', { name: 'do, learning' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Idem' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'mesta, new word' }).className).toContain(
      'bg-token-selected',
    );
  });

  it('takes status labels from props', () => {
    render(
      <TokenText
        text={TEXT}
        tokens={TOKENS}
        onTokenTap={() => {}}
        statusLabels={{ unknown: 'nové slovo' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'mesta, nové slovo' })).toBeInTheDocument();
  });
});
