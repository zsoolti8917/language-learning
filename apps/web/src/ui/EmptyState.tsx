import type { ReactNode } from 'react';
import { cn } from './cn';

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  /** A decorative icon or emoji; hidden from screen readers. */
  icon?: ReactNode;
  /** Usually a Button. */
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong px-gutter py-8 text-center',
        className,
      )}
    >
      {icon != null && (
        <div
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-full bg-surface-2 text-2xl text-fg-muted"
        >
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-fg">{title}</h3>
      {description != null && <p className="max-w-prose text-base text-fg-muted">{description}</p>}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
}
