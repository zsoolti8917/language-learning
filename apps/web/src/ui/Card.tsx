import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export type CardProps = ComponentProps<'div'> & {
  /** Optional heading rendered at the top of the card. */
  title?: ReactNode;
  /** Optional line under the title. */
  subtitle?: ReactNode;
  /** Renders the single child (for example a link) as the card; gives it a hover state. */
  asChild?: boolean;
  /** Tighter padding for list rows. */
  compact?: boolean;
};

export function Card({
  title,
  subtitle,
  asChild = false,
  compact = false,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = cn(
    'block rounded-card border border-border bg-surface text-fg',
    compact ? 'p-3' : 'p-gutter',
    asChild && 'min-h-tap transition-colors hover:bg-surface-2 motion-reduce:transition-none',
    className,
  );
  if (asChild) {
    return (
      <Slot.Root className={classes} {...rest}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <div className={classes} {...rest}>
      {title != null && <h3 className="text-lg font-semibold">{title}</h3>}
      {subtitle != null && <p className="text-sm text-fg-muted">{subtitle}</p>}
      {(title != null || subtitle != null) && children != null ? (
        <div className="mt-3">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
