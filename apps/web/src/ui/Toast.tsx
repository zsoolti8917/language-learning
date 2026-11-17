import { Toast as RadixToast } from 'radix-ui';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from './cn';
import { UI_STRINGS } from './strings';

export type ToastTone = 'info' | 'success' | 'error';

export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds before it closes on its own. Default 5000. */
  duration?: number;
  /** One optional action; `altText` tells screen reader users how to reach it. */
  action?: { label: ReactNode; altText: string; onClick: () => void };
};

export type ToastProps = ToastOptions & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeLabel?: string;
};

const TONE: Record<ToastTone, { bar: string; icon: string; mark: string }> = {
  info: { bar: 'border-l-primary', icon: 'text-primary', mark: 'i' },
  success: { bar: 'border-l-correct', icon: 'text-correct', mark: '✓' },
  error: { bar: 'border-l-wrong', icon: 'text-wrong', mark: '!' },
};

/** One toast. Must sit inside a ToastProvider. Prefer `useToast()` for transient messages. */
export function Toast({
  title,
  description,
  tone = 'info',
  duration,
  action,
  open,
  defaultOpen,
  onOpenChange,
  closeLabel = UI_STRINGS.close,
}: ToastProps) {
  const t = TONE[tone];
  return (
    <RadixToast.Root
      type={tone === 'error' ? 'foreground' : 'background'}
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
      {...(duration !== undefined ? { duration } : {})}
      data-tone={tone}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-card border border-l-4 border-border bg-surface p-3 text-fg shadow-lg',
        'data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] motion-reduce:transition-none',
        t.bar,
      )}
    >
      <span aria-hidden="true" className={cn('mt-0.5 w-5 shrink-0 text-center font-bold', t.icon)}>
        {t.mark}
      </span>
      <div className="min-w-0 flex-1">
        <RadixToast.Title className="font-semibold">{title}</RadixToast.Title>
        {description != null && (
          <RadixToast.Description className="mt-0.5 text-sm text-fg-muted">
            {description}
          </RadixToast.Description>
        )}
      </div>
      {action && (
        <RadixToast.Action
          altText={action.altText}
          onClick={action.onClick}
          className="min-h-tap shrink-0 rounded-control px-3 font-semibold text-primary hover:bg-surface-2"
        >
          {action.label}
        </RadixToast.Action>
      )}
      <RadixToast.Close
        aria-label={closeLabel}
        className="-my-2 -mr-1 grid min-h-tap min-w-tap shrink-0 place-items-center rounded-control text-fg-muted hover:bg-surface-2"
      >
        <span aria-hidden="true">✕</span>
      </RadixToast.Close>
    </RadixToast.Root>
  );
}

type ToastEntry = ToastOptions & { id: number };
type ShowToast = (options: ToastOptions) => void;

const ToastContext = createContext<ShowToast | null>(null);

export type ToastProviderProps = {
  children?: ReactNode;
  /** Accessible name of the toast region. */
  label?: string;
  closeLabel?: string;
  /** Default duration in ms. */
  duration?: number;
};

/** Hosts the toast region at the top of the screen, below the safe area. Wrap the app once. */
export function ToastProvider({
  children,
  label = UI_STRINGS.notifications,
  closeLabel,
  duration = 5000,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const show = useCallback<ShowToast>((options) => {
    setToasts((list) => [...list, { ...options, id: Date.now() + Math.random() }]);
  }, []);
  const remove = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider label={label} duration={duration} swipeDirection="up">
        {children}
        {toasts.map(({ id, ...options }) => (
          <Toast
            key={id}
            {...options}
            {...(closeLabel ? { closeLabel } : {})}
            onOpenChange={(open) => {
              if (!open) remove(id);
            }}
          />
        ))}
        <RadixToast.Viewport className="pointer-events-none fixed inset-x-0 top-0 z-[60] mx-auto flex w-full max-w-lg flex-col gap-2 px-gutter pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

/** Returns `toast(options)`. Throws outside a ToastProvider. */
export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
