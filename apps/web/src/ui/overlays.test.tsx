import './test/setup';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Tabs } from './Tabs';
import { Toast, ToastProvider, useToast } from './Toast';

describe('Sheet', () => {
  it('opens from its trigger, names itself by the title, and closes with Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Sheet
        title="mesto"
        description="town, city"
        trigger={<Button>Open</Button>}
        onOpenChange={onOpenChange}
        footer={<Button>Save</Button>}
      >
        <p>Genitive singular</p>
      </Sheet>,
    );
    const trigger = screen.getByRole('button', { name: 'Open' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'mesto' });
    expect(dialog).toHaveAccessibleDescription('town, city');
    expect(dialog).toHaveTextContent('Genitive singular');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    // vaul keeps the content mounted for its exit animation, marked closed.
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull(),
    );
  });

  it('can be controlled', () => {
    const { rerender } = render(<Sheet open title="Word" hideTitle />);
    expect(screen.getByRole('dialog', { name: 'Word' })).toBeInTheDocument();
    rerender(<Sheet open={false} title="Word" />);
    return waitFor(() =>
      expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull(),
    );
  });
});

describe('Tabs', () => {
  const items = [
    { value: 'sg', label: 'Singular', content: <p>mesto</p> },
    { value: 'pl', label: 'Plural', content: <p>mestá</p> },
    { value: 'x', label: 'Off', content: <p>x</p>, disabled: true },
  ];

  it('shows the first tab and switches on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Number" items={items} onValueChange={onChange} />);
    expect(screen.getByRole('tablist', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Singular' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('mesto');
    await user.click(screen.getByRole('tab', { name: 'Plural' }));
    expect(onChange).toHaveBeenCalledWith('pl');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('mestá');
  });

  it('moves with the arrow keys and skips disabled tabs', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Number" items={items} />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Singular' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Plural' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Plural' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Singular' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Plural' })).toHaveFocus();
  });
});

describe('Toast', () => {
  function Shower() {
    const toast = useToast();
    return (
      <Button
        onClick={() =>
          toast({ title: 'Saved', description: 'mesto is in your deck', tone: 'success' })
        }
      >
        Show
      </Button>
    );
  }

  it('shows a toast through useToast and closes it with its close button', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Shower />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Show' }));
    const region = screen.getByRole('region', { name: /Notifications/ });
    expect(region).toHaveTextContent('Saved');
    expect(region).toHaveTextContent('mesto is in your deck');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(region).not.toHaveTextContent('Saved'));
  });

  it('closes on its own after the duration', async () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider duration={1000}>
          <Toast defaultOpen title="Offline" tone="error" />
        </ToastProvider>,
      );
      expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.queryAllByText('Offline').filter((el) => el.closest('li'))).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs its action', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <Toast
          defaultOpen
          title="Deleted"
          action={{ label: 'Undo', altText: 'Undo delete', onClick }}
        />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('useToast throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Shower />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
