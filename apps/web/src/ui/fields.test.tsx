import './test/setup';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProgressBar } from './ProgressBar';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('is a labelled multi-line field with 16 px text, hint and error', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Textarea
        label="Slovak text"
        hint="Paste an article."
        error="Too long."
        lang="sk"
        onChange={onChange}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Slovak text' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.className).toContain('text-input');
    expect(field).toHaveAttribute('lang', 'sk');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Paste an article. Too long.');
    await user.type(field, 'Ahoj{Enter}svet');
    expect(field).toHaveValue('Ahoj\nsvet');
    expect(onChange).toHaveBeenCalled();
  });

  it('keeps at least three rows and hides the label on request', () => {
    render(<Textarea label="Note" hideLabel rows={1} />);
    const field = screen.getByRole('textbox', { name: 'Note' });
    expect(field).toHaveAttribute('rows', '3');
    expect(screen.getByText('Note')).toHaveClass('sr-only');
  });

  it('counts characters against maxLength, uncontrolled', async () => {
    const user = userEvent.setup();
    render(<Textarea label="Text" showCount maxLength={10} defaultValue="abc" />);
    const field = screen.getByRole('textbox', { name: 'Text' });
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription('3 of 10 characters');
    await user.type(field, 'de');
    expect(screen.getByText('5 / 10')).toBeInTheDocument();
  });

  it('counts a controlled value, marks going over and takes its own count text', () => {
    function Controlled() {
      const [v, setV] = useState('x'.repeat(12));
      return (
        <Textarea
          label="Text"
          value={v}
          onChange={(e) => setV(e.target.value)}
          showCount
          maxLength={10}
          countLabel={(c, m) => `${c}/${m} znakov`}
        />
      );
    }
    render(<Controlled />);
    const count = screen.getByText('12 / 10').closest('p');
    expect(count).toHaveAttribute('data-over');
    expect(screen.getByText('12/10 znakov')).toHaveClass('sr-only');
  });

  it('counts without a maximum', () => {
    render(<Textarea label="Text" showCount defaultValue="ahoj" />);
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('4 characters');
  });
});

describe('ProgressBar', () => {
  it('is a labelled progress bar with a clamped value', () => {
    const { rerender, container } = render(
      <ProgressBar value={2} max={4} label="Placement" valueText="Round 2 of 4" />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Placement' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
    expect(bar).toHaveAttribute('aria-valuetext', 'Round 2 of 4');
    const fill = container.querySelector<HTMLElement>('[data-part="fill"]');
    expect(fill?.style.width).toBe('50%');
    rerender(<ProgressBar value={9} max={4} label="Placement" />);
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(fill?.style.width).toBe('100%');
    rerender(<ProgressBar value={-3} label="Placement" />);
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(fill?.style.width).toBe('0%');
  });

  it('shows its label and value text when asked, without naming the bar twice', () => {
    render(
      <ProgressBar value={1} max={4} label="Rounds" showLabel size="sm" color="var(--ui-correct)">
        1/4
      </ProgressBar>,
    );
    expect(screen.getByText('Rounds')).toBeVisible();
    expect(screen.getByText('1/4')).toBeVisible();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('progressbar')).toHaveClass('h-1');
  });

  it('survives a zero maximum', () => {
    render(<ProgressBar value={0} max={0} label="Empty" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '1');
  });
});
