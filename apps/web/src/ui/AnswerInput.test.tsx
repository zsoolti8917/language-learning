import './test/setup';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnswerInput, type AnswerState } from './AnswerInput';

type Extra = Partial<ComponentProps<typeof AnswerInput>>;

function Harness({ initial = '', ...props }: Extra & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <AnswerInput label="Your answer" value={value} onValueChange={setValue} {...props} />;
}

const input = () => screen.getByRole('textbox', { name: 'Your answer' }) as HTMLInputElement;

describe('AnswerInput', () => {
  it('is a Slovak answer field: lang sk, no autocorrect, no capitals, no spellcheck', () => {
    render(<Harness />);
    const el = input();
    expect(el).toHaveAttribute('lang', 'sk');
    expect(el).toHaveAttribute('autocorrect', 'off');
    expect(el).toHaveAttribute('autocapitalize', 'none');
    expect(el).toHaveAttribute('autocomplete', 'off');
    expect(el).toHaveAttribute('spellcheck', 'false');
    expect(el).toHaveAttribute('type', 'text');
    expect(el.className).toContain('text-answer');
    expect(el.className).toContain('min-h-tap');
  });

  it('starts idle, without status text and not invalid', () => {
    const { container } = render(<Harness />);
    expect(container.firstElementChild).toHaveAttribute('data-state', 'idle');
    expect(input()).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it.each<[AnswerState, string]>([
    ['correct', 'Correct'],
    ['close', 'Almost'],
    ['wrong', 'Wrong'],
  ])('shows the %s state with text, not colour alone', (state, text) => {
    const { container } = render(<Harness state={state} feedback="mesta" />);
    expect(container.firstElementChild).toHaveAttribute('data-state', state);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(text);
    expect(status).toHaveTextContent('mesta');
    expect(input()).toHaveAccessibleDescription(new RegExp(`^${text}.*mesta$`));
    expect(input().className).toContain(`border-${state}`);
    if (state === 'wrong') expect(input()).toHaveAttribute('aria-invalid', 'true');
    else expect(input()).not.toHaveAttribute('aria-invalid');
  });

  it('takes state labels from props (messages file)', () => {
    render(<Harness state="close" stateLabels={{ close: 'Takmer' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Takmer');
  });

  it('submits on Enter with the current value', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(input(), 'mesta{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('mesta');
  });

  it('carries the accent bar, which inserts at the caret and keeps the focus', async () => {
    const user = userEvent.setup();
    render(<Harness initial="zena" />);
    const el = input();
    await user.click(el);
    el.setSelectionRange(1, 1);
    const bar = screen.getByRole('toolbar', { name: 'Slovak letters' });
    await user.click(within(bar).getByRole('button', { name: 'ž' }));
    expect(el.value).toBe('zžena');
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(2);
    await user.keyboard('x');
    expect(el.value).toBe('zžxena');
  });

  it('can hide the accent bar', () => {
    render(<Harness accentBar={false} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('disables the accent bar when read only', () => {
    render(<Harness readOnly state="correct" />);
    const bar = screen.getByRole('toolbar');
    expect(within(bar).getByRole('button', { name: 'á' })).toBeDisabled();
  });

  it('exposes the input element through inputRef', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Harness inputRef={ref} />);
    expect(ref.current).toBe(input());
  });
});
