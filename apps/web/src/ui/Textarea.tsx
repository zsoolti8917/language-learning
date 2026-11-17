import { type ChangeEvent, type ComponentProps, type ReactNode, useId, useState } from 'react';
import { cn } from './cn';
import { fieldClasses } from './Input';
import { UI_STRINGS } from './strings';

export type TextareaProps = ComponentProps<'textarea'> & {
  /** Visible label. Required for accessibility; use `hideLabel` to keep it for screen readers only. */
  label: ReactNode;
  hideLabel?: boolean;
  /** Help text under the field. */
  hint?: ReactNode;
  /** Error text under the field; also sets aria-invalid. */
  error?: ReactNode;
  /**
   * Shows a character counter under the field. Counts against `maxLength` when set
   * ("120 / 20000"), else just the count. The text read out comes from `countLabel`.
   */
  showCount?: boolean;
  /** Accessible text of the counter. Default "{count} of {max} characters" / "{count} characters". */
  countLabel?: (count: number, max: number | undefined) => string;
};

function defaultCountLabel(count: number, max: number | undefined): string {
  return (max === undefined ? UI_STRINGS.charCount : UI_STRINGS.charCountMax)
    .replace('{count}', String(count))
    .replace('{max}', String(max));
}

/**
 * A multi-line text field with the same look, label, hint and error as `Input`: 16 px text,
 * resizable vertically, at least 3 rows. Controlled (`value`) or not (`defaultValue`).
 */
export function Textarea({
  label,
  hideLabel = false,
  hint,
  error,
  showCount = false,
  countLabel = defaultCountLabel,
  id,
  className,
  rows = 4,
  value,
  defaultValue,
  maxLength,
  onChange,
  'aria-describedby': describedBy,
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const countId = showCount ? `${fieldId}-count` : undefined;
  const describedByAll =
    [describedBy, hintId, errorId, countId].filter(Boolean).join(' ') || undefined;
  const [uncontrolled, setUncontrolled] = useState(() => String(defaultValue ?? ''));
  const count = (value !== undefined ? String(value) : uncontrolled).length;
  const over = maxLength !== undefined && count > maxLength;

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (value === undefined) setUncontrolled(e.target.value);
    onChange?.(e);
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={fieldId}
        className={cn('text-sm font-medium text-fg', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <textarea
        id={fieldId}
        rows={Math.max(rows, 3)}
        className={cn(fieldClasses, 'resize-y leading-normal', error ? 'border-wrong' : null)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByAll}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        maxLength={maxLength}
        onChange={handleChange}
        {...rest}
      />
      {(hint || showCount) && (
        <div className="flex items-start justify-between gap-3">
          {hint ? (
            <p id={hintId} className="text-sm text-fg-muted">
              {hint}
            </p>
          ) : (
            <span />
          )}
          {showCount && (
            <p
              id={countId}
              data-over={over ? '' : undefined}
              className={cn(
                'shrink-0 text-sm tabular-nums',
                over ? 'font-medium text-wrong' : 'text-fg-muted',
              )}
            >
              <span aria-hidden="true">
                {maxLength === undefined ? count : `${count} / ${maxLength}`}
              </span>
              <span className="sr-only">{countLabel(count, maxLength)}</span>
            </p>
          )}
        </div>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-wrong">
          {error}
        </p>
      )}
    </div>
  );
}
