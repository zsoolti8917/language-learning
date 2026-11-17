import './test/setup';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Card } from './Card';
import { CaseBadge } from './CaseBadge';
import { CASES } from './cases';
import { EmptyState } from './EmptyState';
import { Input } from './Input';
import { ProgressRing } from './ProgressRing';
import { Skeleton } from './Skeleton';

describe('Button', () => {
  it('is a 44 px tap target of type button, activated by Enter and Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Check</Button>);
    const b = screen.getByRole('button', { name: 'Check' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b.className).toContain('min-h-tap');
    expect(b.className).toContain('min-w-tap');
    await user.tab();
    expect(b).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)('has the %s variant', (v) => {
    render(<Button variant={v}>Go</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('is busy and disabled while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    await user.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link with asChild', () => {
    render(
      <Button asChild>
        <a href="/review">Start</a>
      </Button>,
    );
    const a = screen.getByRole('link', { name: 'Start' });
    expect(a.className).toContain('min-h-tap');
  });
});

describe('Input', () => {
  it('has a label, a hint and an error tied to the field', () => {
    render(<Input label="Email" hint="We never share it" error="Required" type="email" />);
    const el = screen.getByRole('textbox', { name: 'Email' });
    expect(el).toHaveAccessibleDescription('We never share it Required');
    expect(el).toHaveAttribute('aria-invalid', 'true');
    expect(el.className).toContain('text-input');
    expect(el.className).toContain('min-h-tap');
  });

  it('can hide its label visually', () => {
    render(<Input label="Search" hideLabel />);
    expect(screen.getByText('Search')).toHaveClass('sr-only');
    expect(screen.getByRole('textbox', { name: 'Search' })).not.toHaveAttribute('aria-invalid');
  });
});

describe('CaseBadge', () => {
  it.each(CASES)('shows the %s colour together with the case name', (c) => {
    render(<CaseBadge case={c} />);
    const names = {
      nom: 'Nominative',
      gen: 'Genitive',
      dat: 'Dative',
      acc: 'Accusative',
      voc: 'Vocative',
      loc: 'Locative',
      ins: 'Instrumental',
    };
    const badge = screen.getByText(names[c]);
    expect(badge).toHaveAttribute('data-case', c);
    expect(badge.className).toContain(`text-case-${c}`);
    expect(badge.className).toContain(`bg-case-${c}-soft`);
  });

  it('short form keeps the full name for screen readers', () => {
    const { container } = render(<CaseBadge case="gen" variant="short" />);
    expect(container.textContent).toContain('Gen');
    expect(screen.getByText('Genitive')).toHaveClass('sr-only');
  });

  it('takes a label from the messages file', () => {
    render(<CaseBadge case="loc" label="Lokál" suffix="pl." />);
    expect(screen.getByText('Lokál')).toBeInTheDocument();
    expect(screen.getByText('pl.')).toBeInTheDocument();
  });
});

describe('ProgressRing', () => {
  it('is a labelled progress bar with a clamped value', () => {
    const { rerender } = render(
      <ProgressRing value={12} max={20} label="Reviews" valueText="12 of 20">
        12/20
      </ProgressRing>,
    );
    const bar = screen.getByRole('progressbar', { name: 'Reviews' });
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuemax', '20');
    expect(bar).toHaveAttribute('aria-valuetext', '12 of 20');
    expect(bar).toHaveTextContent('12/20');
    rerender(<ProgressRing value={30} max={20} label="Reviews" />);
    expect(bar).toHaveAttribute('aria-valuenow', '20');
    rerender(<ProgressRing value={-1} label="Reviews" />);
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });

  it('fills the arc in proportion', () => {
    const { container } = render(
      <ProgressRing value={1} max={4} label="x" size={64} thickness={4} />,
    );
    const arc = container.querySelectorAll('circle')[1];
    const c = 2 * Math.PI * 30;
    expect(Number(arc?.getAttribute('stroke-dashoffset'))).toBeCloseTo(c * 0.75, 3);
  });
});

describe('Card, EmptyState, Skeleton', () => {
  it('Card shows a title and its content', () => {
    render(
      <Card title="Today" subtitle="12 reviews due">
        <p>body</p>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('12 reviews due')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('Card as a link', () => {
    render(
      <Card asChild>
        <a href="/read/1">Text</a>
      </Card>,
    );
    expect(screen.getByRole('link', { name: 'Text' }).className).toContain('rounded-card');
  });

  it('EmptyState shows title, description and action; the icon is hidden', () => {
    const { container } = render(
      <EmptyState
        icon="📚"
        title="No texts yet"
        description="Paste a text to start reading."
        action={<Button>Import a text</Button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No texts yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import a text' })).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('📚');
  });

  it('Skeleton is hidden from assistive tech and stops pulsing under reduced motion', () => {
    const { container } = render(
      <>
        <Skeleton width={120} />
        <Skeleton lines={3} />
        <Skeleton circle width={48} />
      </>,
    );
    const all = container.querySelectorAll('[data-skeleton]');
    expect(all).toHaveLength(3);
    for (const s of all) expect(s).toHaveAttribute('aria-hidden', 'true');
    expect(all[1]?.children).toHaveLength(3);
    const pulse = container.querySelector('.animate-pulse');
    expect(pulse?.className).toContain('motion-reduce:animate-none');
  });
});
