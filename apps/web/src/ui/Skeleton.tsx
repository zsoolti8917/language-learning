import type { CSSProperties } from 'react';
import { cn } from './cn';

export type SkeletonProps = {
  /** CSS width, for example "60%" or 120. Default full width. */
  width?: CSSProperties['width'];
  /** CSS height. Default 1rem. */
  height?: CSSProperties['height'];
  /** Renders this many text lines; the last one is shorter. */
  lines?: number;
  /** A circle of `width` (for avatars and rings). */
  circle?: boolean;
  className?: string;
};

/**
 * A placeholder while content loads. Decorative: put aria-busy="true" on the
 * region that is loading. The pulse stops under reduced motion.
 */
export function Skeleton({ width, height, lines, circle = false, className }: SkeletonProps) {
  const base = 'block animate-pulse bg-surface-2 motion-reduce:animate-none';
  if (lines && lines > 1) {
    return (
      <span aria-hidden="true" data-skeleton="" className={cn('flex flex-col gap-2', className)}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={cn(base, 'rounded-md')}
            style={{ width: i === lines - 1 ? '60%' : (width ?? '100%'), height: height ?? '1rem' }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-skeleton=""
      className={cn(base, circle ? 'rounded-full' : 'rounded-md', className)}
      style={{
        width: width ?? (circle ? '3rem' : '100%'),
        height: height ?? (circle ? (width ?? '3rem') : '1rem'),
      }}
    />
  );
}
