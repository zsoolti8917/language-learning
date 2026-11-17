import type { ReactNode } from 'react';
import { cn } from './cn';

export type ProgressRingProps = {
  /** Progress, from 0 to `max`. Clamped. */
  value: number;
  max?: number;
  /** Accessible name, for example "Reviews done". */
  label: string;
  /** Diameter in px. Default 64. */
  size?: number;
  /** Ring width in px. Default 6. */
  thickness?: number;
  /** Colour of the filled arc, as any CSS colour; default the primary token. */
  color?: string;
  /** Shown in the middle, for example "12/20". */
  children?: ReactNode;
  /** Text read out instead of the bare number, for example "12 of 20". */
  valueText?: string;
  className?: string;
};

export function ProgressRing({
  value,
  max = 100,
  label,
  size = 64,
  thickness = 6,
  color = 'var(--ui-primary)',
  children,
  valueText,
  className,
}: ProgressRingProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / safeMax);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ui-surface-2)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
        />
      </svg>
      {children != null && (
        <span className="absolute inset-0 grid place-items-center text-sm font-semibold text-fg">
          {children}
        </span>
      )}
    </div>
  );
}
