// Small building blocks of the account screens, made from design system components.
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import { useOnline } from '../../lib/pwa';
import { Button, cn } from '../../ui';
import { m } from './messages';

/** A bare account screen: the title, a line of intro, the form. */
export function AuthScreen({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const online = useOnline();
  return (
    <section className="flex flex-col gap-6 px-gutter py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {intro != null && <p className="text-base text-fg-muted">{intro}</p>}
      </header>
      {!online && <OfflineNote>{m.t('common.offline')}</OfflineNote>}
      {children}
      {footer != null && <footer className="flex flex-col gap-2 text-base">{footer}</footer>}
    </section>
  );
}

export function OfflineNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      data-offline=""
      className="rounded-card border border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg"
    >
      {children}
    </p>
  );
}

/** The error of a whole form (wrong code, no connection), announced at once. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm font-medium text-wrong">
      {children}
    </p>
  );
}

/** A text link with a 44 px tap area. */
export function TextLink({
  to,
  children,
}: {
  to: '/login' | '/signup' | '/reset' | '/';
  children: ReactNode;
}) {
  return (
    <Link to={to} className="inline-flex min-h-tap items-center font-medium text-primary underline">
      {children}
    </Link>
  );
}

export interface ChoiceOption<V extends string | number> {
  value: V;
  label: string;
}

/**
 * A row of buttons where one is chosen (radio semantics): minutes per day, theme, retention.
 * The design system has no radio group, so this composes its Button.
 */
export function ChoiceGroup<V extends string | number>({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  hint?: ReactNode;
  options: readonly ChoiceOption<V>[];
  value: V | undefined;
  onChange: (value: V) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const select = (i: number) => {
    const o = options[(i + options.length) % options.length];
    if (o) onChange(o.value);
    return o;
  };
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span id={`${id}-label`} className="text-sm font-medium text-fg">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-2"
      >
        {options.map((o, i) => {
          const checked = o.value === value;
          return (
            <Button
              key={String(o.value)}
              role="radio"
              aria-checked={checked}
              tabIndex={checked || (value === undefined && i === 0) ? 0 : -1}
              variant={checked ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                const step =
                  e.key === 'ArrowRight' || e.key === 'ArrowDown'
                    ? 1
                    : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                      ? -1
                      : 0;
                if (!step) return;
                e.preventDefault();
                select(i + step);
                const group = e.currentTarget.parentElement;
                const next = group?.children[(i + step + options.length) % options.length];
                if (next instanceof HTMLElement) next.focus();
              }}
              className="px-2"
            >
              {o.label}
            </Button>
          );
        })}
      </div>
      {hint != null && (
        <p id={`${id}-hint`} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
