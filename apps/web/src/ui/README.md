# ui: the design system (F7)

One look and one set of touch friendly components for every screen. Feature
packages import from here and never edit it (shared surface).

```ts
// from apps/web/src/features/<feature>/...
import { AnswerInput, Button, CaseBadge, Sheet, TokenText, useToast } from '../../ui';
```

Styles: the app's CSS entry imports the tokens once, after Tailwind:

```css
@import "tailwindcss";
@import "./ui/tokens.css";
```

`ui/` imports nothing from `features/`, `lib/` or `@app/*` (tested in
`imports.test.ts`). Contract types are mapped onto these props in the feature.

## Rules every component keeps

- Tap targets at least 44 px (`min-h-tap`, `min-w-tap`); field text at least 16 px.
- Answer fields: `lang="sk"`, `autocorrect="off"`, `autocapitalize="none"`, `spellcheck=false`.
- Colours only through tokens, so light and dark come from the same names.
- Visible focus (`:focus-visible` ring in `--ui-focus`), labels on every control.
- Under `prefers-reduced-motion: reduce` animations and transitions stop.
- Text pairs meet WCAG AA (`contrast.test.ts`). State is never shown by colour alone.
- Safe areas: `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`, `px-safe`; Sheet and Toast use them.
- Text a component shows by itself has an English default in `strings.ts` and a prop to
  override it from the app's messages file.

## Tokens

Raw tokens are CSS variables `--ui-*` (in `tokens.css`). Theme: light by default,
dark under `prefers-color-scheme: dark`; `data-theme="light" | "dark"` on `<html>` (or any
subtree) forces one. Tailwind utilities map onto the tokens:

| Token (CSS variable) | Tailwind | Use |
|---|---|---|
| `--ui-bg` | `bg-bg` | page |
| `--ui-surface`, `--ui-surface-2` | `bg-surface`, `bg-surface-2` | cards, sheets; sunken areas, skeletons |
| `--ui-border`, `--ui-border-strong` | `border-border`, `border-border-strong` | dividers; field borders (3:1) |
| `--ui-fg`, `--ui-fg-muted` | `text-fg`, `text-fg-muted` | text |
| `--ui-overlay` | `bg-overlay` | sheet backdrop |
| `--ui-primary`, `-hover`, `-fg`, `-soft` | `bg-primary`, `bg-primary-hover`, `text-primary-fg`, `bg-primary-soft` | main action |
| `--ui-danger`, `--ui-danger-fg` | `bg-danger`, `text-danger-fg` | destructive action |
| `--ui-focus` | `outline-focus` | focus ring |
| `--ui-correct`, `--ui-close`, `--ui-wrong` (+ `-soft`) | `text-correct`, `bg-correct-soft`, … | answer states |
| `--ui-token-unknown`, `--ui-token-learning` (+ `-line`), `--ui-token-selected` | `bg-token-unknown`, `decoration-token-unknown-line`, … | word status |
| `--ui-case-{nom,gen,dat,acc,voc,loc,ins}` (+ `-soft`) | `text-case-gen`, `border-case-gen`, `bg-case-gen-soft` | case colours |
| `--ui-radius-control`, `-card`, `-sheet` | `rounded-control`, `rounded-card`, `rounded-sheet` | radius |
| `--ui-tap` (44 px), `--ui-gutter` (16 px) | `h-tap`, `min-h-tap`, `size-tap`, `px-gutter`, … | spacing |
| `--ui-font-sans` | `font-sans` | system font |
| `--ui-text-input` (16 px), `--ui-text-answer` (20 px), `--ui-text-reading` (18 px) | `text-input`, `text-answer`, `text-reading` | type |

Case colours: one per case, always next to the case name (use `CaseBadge`). For SVG or
inline styles use `caseColorVar('gen')` → `var(--ui-case-gen)`; `CASE_CLASSES[c]` gives the
utility classes; `CASES` lists the seven cases in school order.

## Components

| Component | Key props | Notes |
|---|---|---|
| `Button` | `variant` primary, secondary, ghost, danger; `size` md, lg; `block`; `loading`; `asChild` | `type="button"` by default. `buttonClasses()` gives the classes alone. |
| `Input` | `label` (required), `hideLabel`, `hint`, `error`, all input props | Label, hint and error wired with `aria-describedby`; `aria-invalid` on error. |
| `Textarea` | as `Input` plus all textarea props, `rows` (4, at least 3), `showCount`, `countLabel(count, max)` | Multi-line field with Input's look (16 px text, vertical resize). The counter shows `n / maxLength` (or `n`), turns `text-wrong` above the maximum, and is read out as "n of max characters" through `aria-describedby`. Set `lang="sk"` for Slovak text. |
| `AccentBar` | `target` (ref to input or textarea), `letters`, `allowUppercase`, `docked`, `disabled`, `onInsert`, `label` | Letters á ä č ď é í ĺ ľ ň ó ô ŕ š ť ú ý ž. Inserts at the caret (replaces a selection), fires `input` so React's `onChange` runs, keeps the focus in the field. One tab stop, arrow keys inside. `docked` sits above the on-screen keyboard (visual viewport). `insertAtCaret(field, text)` is exported. |
| `AnswerInput` | `value`, `onValueChange`, `onSubmit` (Enter), `label`, `hideLabel`, `state` idle, correct, close, wrong; `feedback`; `stateLabels`; `accentBar` (default true), `accentBarDocked`; `inputRef` | Slovak answer field with the accent bar. State shows a border, a tint, an icon and a word; `wrong` sets `aria-invalid`; status and feedback sit in a polite live region tied to the field. |
| `Sheet` | `title` (required), `hideTitle`, `description`, `open`, `defaultOpen`, `onOpenChange`, `trigger`, `footer`, `repositionInputs`, `container` | Bottom sheet on vaul. Swipe down, backdrop or Escape closes; focus returns to the trigger. Max 90 dvh; footer above the home indicator. |
| `Card` | `title`, `subtitle`, `compact`, `asChild` | `asChild` turns a link into a card with a hover state. |
| `Tabs` | `items` [{ value, label, content, disabled }], `label` (required), `value`, `defaultValue`, `onValueChange` | Radix tabs; arrow keys, Home, End. |
| `ToastProvider`, `useToast`, `Toast` | provider: `label`, `closeLabel`, `duration`; `toast({ title, description, tone: info, success, error, duration, action: { label, altText, onClick } })` | Wrap the app once in `ToastProvider`. Top of the screen under the safe area. `error` toasts are announced assertively. |
| `ProgressRing` | `value`, `max` (100), `label` (required), `valueText`, `size` (64), `thickness` (6), `color`, `children` (centre text) | `role="progressbar"`, value clamped. |
| `ProgressBar` | `value`, `max` (100), `label` (required), `valueText`, `showLabel` (false), `size` sm, md (md), `color`, `children` (right of the visible label) | Linear `role="progressbar"`, value clamped; the visible label is `aria-hidden` so the bar is named once. |
| `CaseBadge` | `case`, `variant` long, short; `label`; `suffix` | Case colour with its name; short form keeps the long name for screen readers. |
| `TokenText` | `text`, `tokens` [{ start, end, status? }], `onTokenTap(index, token)`, `selected` (indices), `statusLabels`, `lang` ("sk"), `as` | Status unknown, learning, known, ignored (same values as `LemmaStatus`). Unknown: tint and solid underline; learning: tint and dotted underline. With `onTokenTap`, words with a status are buttons with a 44 px hit area, one tab stop and arrow key movement; tokens without a status (punctuation) stay plain text. Offsets are characters into `text`; map `TextAnalysis` tokens (`s`, `e`) onto `start`, `end`. |
| `EmptyState` | `title`, `description`, `icon`, `action` | |
| `Skeleton` | `width`, `height`, `lines`, `circle` | `aria-hidden`; put `aria-busy` on the loading region. |

Helpers: `cn(...classes)`, `fieldClasses`, `UI_STRINGS`.

## Gallery and tests

- Gallery: `pnpm --filter @app/web dev`, then open `/gallery.html` (`?theme=light|dark`).
  Source in `ui/gallery/`, entry `apps/web/gallery.html`. Both themes on one page.
- Unit tests: `*.test.ts(x)` beside the components (`pnpm test --filter web`). Each imports
  `./test/setup` (jest-dom matchers, cleanup, jsdom gaps).
- Browser tests of the gallery: `pnpm --filter @app/web test:ui` (Playwright, config in
  `apps/web/e2e-ui/`), 390 x 844, light and dark.
