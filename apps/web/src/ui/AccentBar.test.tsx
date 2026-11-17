import './test/setup';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ACCENT_LETTERS, AccentBar, insertAtCaret } from './AccentBar';

function Field({ initial = '', allowUppercase = false, onChange = (_: string) => {} }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        aria-label="answer"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value);
        }}
      />
      <AccentBar target={ref} allowUppercase={allowUppercase} />
    </>
  );
}

const field = () => screen.getByRole('textbox', { name: 'answer' }) as HTMLInputElement;

describe('AccentBar', () => {
  it('offers the 17 Slovak letters in order', () => {
    render(<Field />);
    const bar = screen.getByRole('toolbar', { name: 'Slovak letters' });
    const letters = Array.from(bar.querySelectorAll('button')).map((b) => b.textContent);
    expect(letters).toEqual([...ACCENT_LETTERS]);
    expect(letters.join(' ')).toBe('á ä č ď é í ĺ ľ ň ó ô ŕ š ť ú ý ž');
  });

  it('inserts a letter at the caret, moves the caret after it and keeps the focus', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field initial="mesto" onChange={onChange} />);
    const input = field();
    await user.click(input);
    input.setSelectionRange(2, 2);
    await user.click(screen.getByRole('button', { name: 'š' }));
    expect(input.value).toBe('mešsto');
    expect(onChange).toHaveBeenLastCalledWith('mešsto');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
    // Typing continues at the caret.
    await user.keyboard('x');
    expect(input.value).toBe('mešxsto');
  });

  it('replaces a selection', async () => {
    const user = userEvent.setup();
    render(<Field initial="mesto" />);
    const input = field();
    await user.click(input);
    input.setSelectionRange(1, 2);
    await user.click(screen.getByRole('button', { name: 'é' }));
    expect(input.value).toBe('mésto');
    expect(input.selectionStart).toBe(2);
  });

  it('does not take the focus on press (mousedown is prevented)', () => {
    render(<Field />);
    const allowed = fireEvent.mouseDown(screen.getByRole('button', { name: 'á' }));
    expect(allowed).toBe(false);
  });

  it('works from the keyboard and returns the focus to the field', async () => {
    const user = userEvent.setup();
    render(<Field initial="dobry" />);
    const input = field();
    await user.click(input);
    input.setSelectionRange(5, 5);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'á' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ä' }));
    await user.keyboard('{ArrowLeft}{Enter}');
    expect(input.value).toBe('dobryá');
    expect(document.activeElement).toBe(input);
  });

  it('switches to capitals with the shift key, for one letter', async () => {
    const user = userEvent.setup();
    render(<Field allowUppercase />);
    const input = field();
    await user.click(input);
    const shift = screen.getByRole('button', { name: 'Capital letters' });
    await user.click(shift);
    expect(shift).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Č' }));
    await user.click(screen.getByRole('button', { name: 'á' }));
    expect(input.value).toBe('Čá');
    expect(shift).toHaveAttribute('aria-pressed', 'false');
  });

  it('insertAtCaret appends when the field has no selection API', () => {
    const input = document.createElement('input');
    input.type = 'email';
    input.value = 'a';
    const onInput = vi.fn();
    input.addEventListener('input', onInput);
    insertAtCaret(input, 'ž');
    expect(input.value).toBe('až');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('works with a textarea', () => {
    const area = document.createElement('textarea');
    area.value = 'ab';
    area.setSelectionRange(1, 1);
    insertAtCaret(area, 'ô');
    expect(area.value).toBe('aôb');
    expect(area.selectionStart).toBe(2);
  });
});
