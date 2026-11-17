import { type ComponentProps, type ReactNode, useId } from 'react';
import { cn } from './cn';

export type InputProps = Omit<ComponentProps<'input'>, 'size'> & {
  /** Visible label. Required for accessibility; use `hideLabel` to keep it for screen readers only. */
  label: ReactNode;
  hideLabel?: boolean;
  /** Help text under the field. */
  hint?: ReactNode;
  /** Error text under the field; also sets aria-invalid. */
  error?: ReactNode;
};

/** Field classes shared with AnswerInput: at least 16 px text (no iOS zoom), at least 44 px tall. */
export const fieldClasses = cn(
  'block w-full min-h-tap rounded-control border bg-surface px-3 py-2 text-input text-fg',
  'placeholder:text-fg-muted border-border-strong',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function Input({
  label,
  hideLabel = false,
  hint,
  error,
  id,
  className,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedByAll = [describedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={inputId}
        className={cn('text-sm font-medium text-fg', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <input
        id={inputId}
        className={cn(fieldClasses, error ? 'border-wrong' : null)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByAll}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-wrong">
          {error}
        </p>
      )}
    </div>
  );
}
