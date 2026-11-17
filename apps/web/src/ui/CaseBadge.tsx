import type { ReactNode } from 'react';
import { CASE_CLASSES, type CaseName } from './cases';
import { cn } from './cn';
import { UI_STRINGS } from './strings';

export type CaseBadgeProps = {
  case: CaseName;
  /** `long` shows "Genitive", `short` shows "Gen" with the long name for screen readers. */
  variant?: 'long' | 'short';
  /** Overrides the case name, for example from the messages file. */
  label?: string;
  /** Extra text after the name, for example "pl." */
  suffix?: ReactNode;
  className?: string;
};

/** A case's colour together with its name. The colour never appears without the name. */
export function CaseBadge({ case: c, variant = 'long', label, suffix, className }: CaseBadgeProps) {
  const cls = CASE_CLASSES[c];
  const longName = label ?? UI_STRINGS.caseNames[c];
  const shown = variant === 'short' && !label ? UI_STRINGS.caseShort[c] : longName;
  return (
    <span
      data-case={c}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap',
        cls.text,
        cls.border,
        cls.soft,
        className,
      )}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      {variant === 'short' && !label ? (
        <abbr title={longName} className="no-underline">
          <span aria-hidden="true">{shown}</span>
          <span className="sr-only">{longName}</span>
        </abbr>
      ) : (
        shown
      )}
      {suffix != null && <span className="font-normal">{suffix}</span>}
    </span>
  );
}
