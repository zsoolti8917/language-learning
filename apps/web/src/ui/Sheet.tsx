import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { cn } from './cn';

export type SheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Heading of the sheet; also its accessible name. */
  title: ReactNode;
  hideTitle?: boolean;
  description?: ReactNode;
  /** An element that opens the sheet, usually a Button. Rendered with asChild. */
  trigger?: ReactNode;
  children?: ReactNode;
  /** Fixed area under the content, for actions. Kept above the home indicator. */
  footer?: ReactNode;
  /** Keep false when the sheet holds an input that must not jump with the keyboard. */
  repositionInputs?: boolean;
  /** Element to render into instead of document.body (for example a themed subtree). */
  container?: HTMLElement | null;
  className?: string;
};

/**
 * The bottom sheet (vaul). Swipe down, tap the backdrop or press Escape to close.
 * Focus moves into the sheet and returns to the trigger on close.
 */
export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  title,
  hideTitle = false,
  description,
  trigger,
  children,
  footer,
  repositionInputs,
  container,
  className,
}: SheetProps) {
  return (
    <Drawer.Root
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
      {...(repositionInputs !== undefined ? { repositionInputs } : {})}
      {...(container ? { container } : {})}
    >
      {trigger && <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>}
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Drawer.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col',
            'rounded-t-sheet border border-b-0 border-border bg-surface text-fg outline-none',
            className,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <Drawer.Handle className="mx-auto mt-3 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-border-strong" />
          <div className="px-gutter pt-2">
            <Drawer.Title className={cn('text-xl font-semibold text-fg', hideTitle && 'sr-only')}>
              {title}
            </Drawer.Title>
            {description && (
              <Drawer.Description className="mt-1 text-base text-fg-muted">
                {description}
              </Drawer.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-gutter py-3">{children}</div>
          {footer && (
            <div className="border-t border-border px-gutter pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
              {footer}
            </div>
          )}
          {!footer && <div className="pb-safe" />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
