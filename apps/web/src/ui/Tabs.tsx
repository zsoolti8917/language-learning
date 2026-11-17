import { Tabs as RadixTabs } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from './cn';

export type TabItem = {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  items: TabItem[];
  /** Accessible name of the tab list. */
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
};

/**
 * Segmented tabs. Arrow keys move between tabs (Home and End jump), and a tab
 * activates when it receives focus.
 */
export function Tabs({ items, label, value, defaultValue, onValueChange, className }: TabsProps) {
  const first = items[0]?.value;
  return (
    <RadixTabs.Root
      {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? first })}
      {...(onValueChange ? { onValueChange } : {})}
      className={cn('flex flex-col gap-3', className)}
    >
      <RadixTabs.List
        aria-label={label}
        className="flex w-full gap-1 overflow-x-auto rounded-control bg-surface-2 p-1"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(
              'min-h-tap min-w-tap flex-1 shrink-0 rounded-[calc(var(--ui-radius-control)-0.25rem)] px-3 text-base font-medium',
              'text-fg-muted hover:text-fg disabled:opacity-50',
              'data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm',
            )}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value}>
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
