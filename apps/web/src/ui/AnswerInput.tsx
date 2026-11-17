import {
  type ComponentProps,
  type ReactNode,
  type Ref,
  useId,
  useImperativeHandle,
  useRef,
} from 'react';
import { AccentBar } from './AccentBar';
import { cn } from './cn';
import { fieldClasses } from './Input';
import { UI_STRINGS } from './strings';

export type AnswerState = 'idle' | 'correct' | 'close' | 'wrong';

export type AnswerInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'onSubmit' | 'type' | 'size' | 'ref' | 'lang'
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Called on Enter with the current value. */
  onSubmit?: (value: string) => void;
  /** Visible label; `hideLabel` keeps it for screen readers only. */
  label: ReactNode;
  hideLabel?: boolean;
  state?: AnswerState;
  /** Shown under the field, for example the expected answer. Announced politely. */
  feedback?: ReactNode;
  /** Text shown with each state (defaults: Correct, Almost, Wrong). */
  stateLabels?: Partial<Record<AnswerState, string>>;
  /** Shows the accent bar under the field. Default true. */
  accentBar?: boolean;
  /** Docks the accent bar above the on-screen keyboard. */
  accentBarDocked?: boolean;
  accentBarLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
};

const STATE_FIELD: Record<AnswerState, string> = {
  idle: '',
  correct: 'border-correct bg-correct-soft border-2',
  close: 'border-close bg-close-soft border-2',
  wrong: 'border-wrong bg-wrong-soft border-2',
};

const STATE_TEXT: Record<AnswerState, string> = {
  idle: 'text-fg-muted',
  correct: 'text-correct',
  close: 'text-close',
  wrong: 'text-wrong',
};

const STATE_ICON: Record<AnswerState, string> = { idle: '', correct: '✓', close: '≈', wrong: '✕' };

/**
 * The field for a typed Slovak answer: lang="sk", no autocorrect, no automatic
 * capitals, no spellcheck, 20 px text, the accent bar, and the states idle,
 * correct, close and wrong. A state is never shown by colour alone.
 */
export function AnswerInput({
  value,
  onValueChange,
  onSubmit,
  label,
  hideLabel = false,
  state = 'idle',
  feedback,
  stateLabels,
  accentBar = true,
  accentBarDocked = false,
  accentBarLabel,
  inputRef,
  id,
  className,
  disabled,
  onKeyDown,
  'aria-describedby': describedBy,
  ...rest
}: AnswerInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const statusId = `${inputId}-status`;
  const ref = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => ref.current as HTMLInputElement, []);

  const stateText = { ...UI_STRINGS.answerStates, ...stateLabels }[state];
  const hasStatus = state !== 'idle' || feedback != null;

  return (
    <div className={cn('flex flex-col gap-2', className)} data-state={state}>
      <label
        htmlFor={inputId}
        className={cn('text-sm font-medium text-fg', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type="text"
          lang="sk"
          autoCorrect="off"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          value={value}
          disabled={disabled}
          aria-invalid={state === 'wrong' ? true : undefined}
          aria-describedby={
            [describedBy, hasStatus ? statusId : undefined].filter(Boolean).join(' ') || undefined
          }
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (!e.defaultPrevented && e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit?.(e.currentTarget.value);
            }
          }}
          className={cn(
            fieldClasses,
            'text-answer',
            state !== 'idle' && 'pr-12',
            STATE_FIELD[state],
          )}
          {...rest}
        />
        {state !== 'idle' && (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xl font-bold',
              STATE_TEXT[state],
            )}
          >
            {STATE_ICON[state]}
          </span>
        )}
      </div>
      <div id={statusId} role="status" aria-live="polite" className="min-h-6 text-base">
        {state !== 'idle' && (
          <span className={cn('font-semibold', STATE_TEXT[state])}>{stateText}</span>
        )}
        {state !== 'idle' && feedback != null && <span className="text-fg"> · </span>}
        {feedback != null && <span className="text-fg">{feedback}</span>}
      </div>
      {accentBar && (
        <AccentBar
          target={ref}
          disabled={disabled || rest.readOnly}
          docked={accentBarDocked}
          {...(accentBarLabel ? { label: accentBarLabel } : {})}
        />
      )}
    </div>
  );
}
