import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import { UI_STRINGS } from './strings';

/** Status of a word for the learner. Same values as `LemmaStatus` in contracts. */
export type TokenStatus = 'unknown' | 'learning' | 'known' | 'ignored';

/**
 * One token of `text`: character offsets [start, end). A token without a status
 * (punctuation, numbers) is shown as plain text and cannot be tapped.
 */
export type TextToken = {
  start: number;
  end: number;
  status?: TokenStatus | null;
};

export type TokenTextProps = {
  /** The sentence or paragraph, exactly as the offsets point into it. */
  text: string;
  tokens: readonly TextToken[];
  /** Makes words tappable buttons. Receives the index into `tokens`. */
  onTokenTap?: (index: number, token: TextToken) => void;
  /** Indices of selected tokens (for example while building a phrase). Sets aria-pressed. */
  selected?: readonly number[];
  /** Words read out with each status (defaults: new word, learning, known, ignored). */
  statusLabels?: Partial<Record<TokenStatus, string>>;
  /** Language of the text. Default "sk". */
  lang?: string;
  /** Render element. Default "p". */
  as?: 'p' | 'div' | 'span';
  className?: string;
};

const STATUS_CLASS: Record<TokenStatus, string> = {
  unknown:
    'bg-token-unknown underline decoration-token-unknown-line decoration-2 underline-offset-4',
  learning:
    'bg-token-learning underline decoration-dotted decoration-token-learning-line decoration-2 underline-offset-4',
  known: '',
  ignored: '',
};

type Piece =
  | { kind: 'text'; text: string; key: string }
  | { kind: 'token'; text: string; key: string; index: number; token: TextToken };

function split(text: string, tokens: readonly TextToken[]): Piece[] {
  const order = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token.end > token.start)
    .sort((a, b) => a.token.start - b.token.start);
  const out: Piece[] = [];
  let at = 0;
  for (const { token, index } of order) {
    if (token.start < at) continue; // overlapping token: skip
    if (token.start > at)
      out.push({ kind: 'text', text: text.slice(at, token.start), key: `t${at}` });
    out.push({
      kind: 'token',
      text: text.slice(token.start, token.end),
      key: `k${index}`,
      index,
      token,
    });
    at = token.end;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at), key: `t${at}` });
  return out;
}

/**
 * Renders text from tokens with a colour per word status. Unknown words are
 * tinted with a solid underline, words being learnt with a dotted one, so status
 * never depends on colour alone. With `onTokenTap`, every word with a status is a
 * button with a 44 px tall tap area; arrow keys move between words and only one
 * word is in the tab order.
 */
export function TokenText({
  text,
  tokens,
  onTokenTap,
  selected,
  statusLabels,
  lang = 'sk',
  as: Tag = 'p',
  className,
}: TokenTextProps) {
  const pieces = useMemo(() => split(text, tokens), [text, tokens]);
  const tappable = useMemo(
    () =>
      onTokenTap
        ? pieces.flatMap((p) => (p.kind === 'token' && p.token.status ? [p.index] : []))
        : [],
    [pieces, onTokenTap],
  );
  const [active, setActive] = useState<number | null>(null);
  const current = active !== null && tappable.includes(active) ? active : (tappable[0] ?? null);
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const selectedSet = useMemo(() => (selected ? new Set(selected) : null), [selected]);
  const labels = { ...UI_STRINGS.tokenStatus, ...statusLabels };

  const move = (e: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const pos = tappable.indexOf(from);
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tappable[pos + 1];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tappable[pos - 1];
    else if (e.key === 'Home') next = tappable[0];
    else if (e.key === 'End') next = tappable[tappable.length - 1];
    else return;
    e.preventDefault();
    if (next === undefined) return;
    setActive(next);
    refs.current.get(next)?.focus();
  };

  const children: ReactNode[] = pieces.map((p) => {
    if (p.kind === 'text') return p.text;
    const status = p.token.status ?? null;
    const isSelected = selectedSet?.has(p.index) ?? false;
    const cls = cn(
      'rounded-sm',
      status && STATUS_CLASS[status],
      isSelected && 'bg-token-selected ring-2 ring-primary',
    );
    if (!onTokenTap || !status) {
      return (
        <span key={p.key} data-status={status ?? undefined} className={cls || undefined}>
          {p.text}
        </span>
      );
    }
    const spoken =
      status === 'unknown' || status === 'learning' ? `${p.text}, ${labels[status]}` : undefined;
    return (
      <button
        key={p.key}
        ref={(el) => {
          if (el) refs.current.set(p.index, el);
          else refs.current.delete(p.index);
        }}
        type="button"
        data-status={status}
        data-token={p.index}
        tabIndex={p.index === current ? 0 : -1}
        aria-label={spoken}
        aria-pressed={selectedSet ? isSelected : undefined}
        onClick={() => {
          setActive(p.index);
          onTokenTap(p.index, p.token);
        }}
        onKeyDown={(e) => move(e, p.index)}
        className={cn(
          cls,
          'relative inline cursor-pointer p-0 text-inherit [font:inherit]',
          // Invisible hit area: at least 44 px tall around the word.
          "before:absolute before:inset-x-0 before:top-1/2 before:h-tap before:-translate-y-1/2 before:content-['']",
          !status || status === 'known' || status === 'ignored' ? 'hover:bg-surface-2' : '',
        )}
      >
        {p.text}
      </button>
    );
  });

  return (
    <Tag lang={lang} className={cn('text-reading text-fg', className)}>
      {children}
    </Tag>
  );
}
