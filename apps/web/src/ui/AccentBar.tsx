import { Toolbar } from 'radix-ui';
import { type CSSProperties, type RefObject, useEffect, useState } from 'react';
import { cn } from './cn';
import { UI_STRINGS } from './strings';

/** The Slovak letters a phone keyboard often hides, in alphabetical order. */
export const ACCENT_LETTERS = [
  'á',
  'ä',
  'č',
  'ď',
  'é',
  'í',
  'ĺ',
  'ľ',
  'ň',
  'ó',
  'ô',
  'ŕ',
  'š',
  'ť',
  'ú',
  'ý',
  'ž',
] as const;

export type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Inserts text at the caret of a field (replacing any selection), moves the caret
 * after it, and fires an `input` event so React's onChange sees the new value.
 */
export function insertAtCaret(field: TextField, text: string): void {
  const value = field.value;
  let start: number;
  let end: number;
  try {
    start = field.selectionStart ?? value.length;
    end = field.selectionEnd ?? start;
  } catch {
    start = value.length;
    end = start;
  }
  const next = value.slice(0, start) + text + value.slice(end);
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  // The prototype setter bypasses React's value tracker, so React reports the change.
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, next);
  const caret = start + text.length;
  try {
    field.setSelectionRange(caret, caret);
  } catch {
    // Field types without a selection (email, number) keep the caret at the end.
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Height of the on-screen keyboard, read from the visual viewport (0 when closed or unknown). */
function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!enabled || !vv) return;
    const update = () =>
      setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [enabled]);
  return inset;
}

export type AccentBarProps = {
  /** The field the letters go into. */
  target: RefObject<TextField | null>;
  letters?: readonly string[];
  /** Accessible name of the toolbar. */
  label?: string;
  /** Offers a shift key that switches the letters to capitals. */
  allowUppercase?: boolean;
  shiftLabel?: string;
  disabled?: boolean;
  /** Fixes the bar to the bottom of the screen, just above the on-screen keyboard. */
  docked?: boolean;
  onInsert?: (letter: string) => void;
  className?: string;
};

export function AccentBar({
  target,
  letters = ACCENT_LETTERS,
  label = UI_STRINGS.accentBar,
  allowUppercase = false,
  shiftLabel = 'Capital letters',
  disabled = false,
  docked = false,
  onInsert,
  className,
}: AccentBarProps) {
  const [upper, setUpper] = useState(false);
  const inset = useKeyboardInset(docked);

  const insert = (letter: string) => {
    const field = target.current;
    if (!field || disabled) return;
    const text = upper ? letter.toLocaleUpperCase('sk') : letter;
    // Focus first: a keyboard user may have moved focus to the bar.
    if (document.activeElement !== field) field.focus();
    insertAtCaret(field, text);
    onInsert?.(text);
    if (upper) setUpper(false);
  };

  // A press must not take the focus from the field, or the phone keyboard closes.
  // Preventing mousedown (also fired after a tap) stops the focus change.
  const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

  const style: CSSProperties | undefined = docked ? { bottom: inset } : undefined;

  return (
    <Toolbar.Root
      aria-label={label}
      loop={false}
      style={style}
      className={cn(
        'flex w-full max-w-full items-center gap-1 overflow-x-auto overscroll-x-contain bg-surface-2 p-1',
        docked ? 'fixed inset-x-0 z-40 border-t border-border px-safe' : 'rounded-control',
        className,
      )}
    >
      {allowUppercase && (
        <Toolbar.Button
          type="button"
          aria-pressed={upper}
          aria-label={shiftLabel}
          disabled={disabled}
          onMouseDown={keepFocus}
          onClick={() => setUpper((u) => !u)}
          className={cn(
            'grid min-h-tap min-w-tap shrink-0 place-items-center rounded-control text-lg font-semibold',
            upper ? 'bg-primary text-primary-fg' : 'bg-surface text-fg',
          )}
        >
          ⇧
        </Toolbar.Button>
      )}
      {letters.map((letter) => {
        const shown = upper ? letter.toLocaleUpperCase('sk') : letter;
        return (
          <Toolbar.Button
            key={letter}
            type="button"
            lang="sk"
            disabled={disabled}
            onMouseDown={keepFocus}
            onClick={() => insert(letter)}
            className="grid min-h-tap min-w-tap shrink-0 place-items-center rounded-control bg-surface text-lg font-medium text-fg hover:bg-primary-soft disabled:opacity-50"
          >
            {shown}
          </Toolbar.Button>
        );
      })}
    </Toolbar.Root>
  );
}
