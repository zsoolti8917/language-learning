import type { ReactNode } from 'react';
import { cn } from './cn';

export type ProgressBarProps = {
  /** Progress, from 0 to `max`. Clamped. */
  value: number;
  max?: number;
  /** Accessible name, for example "Placement progress". */
  label: string;
  /** Shows `label` (and `children` on the right) above the bar. Default false. */
  showLabel?: boolean;
  /** Text read out instead of the bare number, for example "Round 2 of 4". */
  valueText?: string;
  /** Bar height: sm 4 px, md 8 px (default). */
  size?: 'sm' | 'md';
  /** Colour of the filled part, as any CSS colour; default the primary token. */
  color?: string;
  /** Shown on the right of the visible label, for example "2/4". Needs `showLabel`. */
  children?: ReactNode;
  className?: string;
};

/** A linear progress bar, the straight sibling of `ProgressRing`. */
export function ProgressBar({
  value,
  max = 100,
  label,
  showLabel = false,
  valueText,
  size = 'md',
  color = 'var(--ui-primary)',
  children,
  className,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {showLabel && (
        <div aria-hidden="true" className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium text-fg">{label}</span>
          {children != null && <span className="tabular-nums text-fg-muted">{children}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        aria-valuetext={valueText}
        className={cn(
          'w-full overflow-hidden rounded-full bg-surface-2',
          size === 'sm' ? 'h-1' : 'h-2',
        )}
      >
        <div
          data-part="fill"
          className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
    </div>
  );
}
