import { type ReactNode, useId, useRef, useState } from 'react';
import { AccentBar } from '../AccentBar';
import { AnswerInput, type AnswerState } from '../AnswerInput';
import { Button } from '../Button';
import { Card } from '../Card';
import { CaseBadge } from '../CaseBadge';
import { CASES, caseColorVar } from '../cases';
import { EmptyState } from '../EmptyState';
import { Input } from '../Input';
import { ProgressRing } from '../ProgressRing';
import { Sheet } from '../Sheet';
import { Skeleton } from '../Skeleton';
import { Tabs } from '../Tabs';
import { ToastProvider, useToast } from '../Toast';
import { type TextToken, TokenText } from '../TokenText';

export type GalleryTheme = 'light' | 'dark' | 'system';

export function readTheme(search: string): GalleryTheme {
  const t = new URLSearchParams(search).get('theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

function applyTheme(theme: GalleryTheme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const url = new URL(window.location.href);
  if (theme === 'system') url.searchParams.delete('theme');
  else url.searchParams.set('theme', theme);
  window.history.replaceState(null, '', url);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-border pt-5">
      <h3 id={id} className="text-lg font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

const SENTENCE = 'Zajtra idem s kamarátom do mesta.';
const SENTENCE_TOKENS: TextToken[] = [
  { start: 0, end: 6, status: 'known' },
  { start: 7, end: 11, status: 'known' },
  { start: 12, end: 13, status: 'learning' },
  { start: 14, end: 23, status: 'unknown' },
  { start: 24, end: 26, status: 'ignored' },
  { start: 27, end: 32, status: 'unknown' },
  { start: 32, end: 33 },
];

function fold(s: string) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
}

function AnswerDemo() {
  const [value, setValue] = useState('');
  const [state, setState] = useState<AnswerState>('idle');
  const expected = 'mesta';
  return (
    <AnswerInput
      label="Idem do (mesto) — type the genitive"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        setState('idle');
      }}
      state={state}
      feedback={
        state === 'idle' ? undefined : state === 'correct' ? 'mesta' : `Expected: ${expected}`
      }
      onSubmit={(v) => {
        const given = v.trim().toLowerCase();
        setState(
          given === expected ? 'correct' : fold(given) === fold(expected) ? 'close' : 'wrong',
        );
      }}
      data-testid="answer-demo"
    />
  );
}

function AccentDemo() {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Free text (with shift for capitals)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        ref={ref}
        lang="sk"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      <AccentBar target={ref} allowUppercase />
    </div>
  );
}

function TokenDemo() {
  const [selected, setSelected] = useState<number[]>([]);
  const [last, setLast] = useState<string>('—');
  return (
    <div className="flex flex-col gap-2">
      <TokenText
        text={SENTENCE}
        tokens={SENTENCE_TOKENS}
        selected={selected}
        onTokenTap={(i, t) => {
          setLast(SENTENCE.slice(t.start, t.end));
          setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
        }}
      />
      <p className="text-sm text-fg-muted">Last tapped: {last}</p>
    </div>
  );
}

function ToastDemo() {
  const toast = useToast();
  return (
    <Row>
      <Button
        variant="secondary"
        onClick={() => toast({ title: 'Synced', description: 'All reviews are saved.' })}
      >
        Info toast
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({ title: 'Saved', description: 'mesto is in your deck', tone: 'success' })
        }
      >
        Success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            title: 'You are offline',
            description: 'Answers wait and are sent later.',
            tone: 'error',
            action: { label: 'Retry', altText: 'Retry sending', onClick: () => {} },
          })
        }
      >
        Error toast
      </Button>
    </Row>
  );
}

function SheetDemo({ container }: { container: HTMLElement | null }) {
  return (
    <Sheet
      title="mesto"
      description="town, city · noun, neuter"
      container={container}
      trigger={<Button variant="secondary">Open sheet</Button>}
      footer={
        <div className="grid grid-cols-3 gap-2">
          <Button>Save</Button>
          <Button variant="secondary">Known</Button>
          <Button variant="ghost">Ignore</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p>
          <span lang="sk" className="font-semibold">
            do mesta
          </span>{' '}
          — genitive singular after <span lang="sk">do</span>.
        </p>
        <CaseBadge case="gen" suffix="sg." />
        <AnswerInput label="Type the locative singular" value="" onValueChange={() => {}} />
      </div>
    </Sheet>
  );
}

function ThemeBlock({ theme }: { theme: 'light' | 'dark' }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const heading = theme === 'light' ? 'Light theme' : 'Dark theme';
  const id = useId();
  return (
    <section
      ref={setContainer}
      data-theme={theme}
      aria-labelledby={id}
      data-testid={`block-${theme}`}
      className="flex flex-col gap-5 rounded-card px-gutter py-6"
    >
      <h2 id={id} className="text-2xl font-bold">
        {heading}
      </h2>

      <Section title="Case colours">
        <Row>
          {CASES.map((c) => (
            <CaseBadge key={c} case={c} />
          ))}
        </Row>
        <Row>
          {CASES.map((c) => (
            <CaseBadge key={c} case={c} variant="short" />
          ))}
          <CaseBadge case="ins" suffix="pl." />
        </Row>
      </Section>

      <Section title="Button">
        <Row>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
        </Row>
        <Row>
          <Button disabled>Disabled</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button loading>Saving</Button>
        </Row>
        <Button size="lg" block>
          Start review
        </Button>
        <Button asChild variant="secondary">
          <a href="#top">Link styled as a button</a>
        </Button>
      </Section>

      <Section title="Input">
        <Input label="Email" type="email" placeholder="you@example.com" autoComplete="email" />
        <Input label="Password" type="password" hint="At least 8 characters." />
        <Input label="Display name" defaultValue="x" error="Too short." />
        <Input label="Disabled" disabled defaultValue="Read only" />
      </Section>

      <Section title="AccentBar">
        <AccentDemo />
      </Section>

      <Section title="AnswerInput">
        <AnswerDemo />
        <AnswerInput
          label="Idle"
          value=""
          onValueChange={() => {}}
          accentBar={false}
          placeholder="Type here"
        />
        <AnswerInput
          label="Correct"
          value="mesta"
          onValueChange={() => {}}
          state="correct"
          readOnly
          accentBar={false}
        />
        <AnswerInput
          label="Close (accents)"
          value="mesta"
          onValueChange={() => {}}
          state="close"
          feedback="Mind the accent: mestá"
          readOnly
          accentBar={false}
        />
        <AnswerInput
          label="Wrong"
          value="meste"
          onValueChange={() => {}}
          state="wrong"
          feedback="Expected: mesta"
          readOnly
          accentBar={false}
        />
        <AnswerInput
          label="Disabled"
          value=""
          onValueChange={() => {}}
          disabled
          accentBar={false}
        />
      </Section>

      <Section title="TokenText">
        <TokenDemo />
        <TokenText text={SENTENCE} tokens={SENTENCE_TOKENS} />
      </Section>

      <Section title="Sheet">
        <SheetDemo container={container} />
      </Section>

      <Section title="Card">
        <Card title="Today" subtitle="12 reviews due · 1 lesson">
          <p>Cards hold a group of content on a surface.</p>
        </Card>
        <Card compact>A compact card for list rows.</Card>
        <Card asChild>
          <a href="#top">
            <span className="font-semibold">Card as a link</span>
            <span className="block text-sm text-fg-muted">Opens a text in the reader</span>
          </a>
        </Card>
      </Section>

      <Section title="Tabs">
        <Tabs
          label="Number"
          items={[
            { value: 'sg', label: 'Singular', content: <p lang="sk">mesto, mesta, mestu</p> },
            { value: 'pl', label: 'Plural', content: <p lang="sk">mestá, miest, mestám</p> },
            { value: 'x', label: 'Dual', content: null, disabled: true },
          ]}
        />
      </Section>

      <Section title="Toast">
        <ToastDemo />
      </Section>

      <Section title="ProgressRing">
        <Row>
          <ProgressRing value={0} max={20} label="Reviews done" valueText="0 of 20">
            0
          </ProgressRing>
          <ProgressRing value={7} max={20} label="Reviews done" valueText="7 of 20">
            7/20
          </ProgressRing>
          <ProgressRing value={20} max={20} label="Reviews done" color="var(--ui-correct)">
            ✓
          </ProgressRing>
          <ProgressRing
            value={3}
            max={5}
            label="Genitive mastery"
            color={caseColorVar('gen')}
            size={48}
          />
          <ProgressRing value={60} label="Loading" size={88} thickness={10}>
            60%
          </ProgressRing>
        </Row>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          icon="📚"
          title="No texts yet"
          description="Paste a Slovak text to read it with glosses."
          action={<Button>Import a text</Button>}
        />
        <EmptyState title="Nothing due" description="Come back tomorrow." />
      </Section>

      <Section title="Skeleton">
        <div aria-busy="true" className="flex items-center gap-3">
          <Skeleton circle width={48} />
          <div className="flex-1">
            <Skeleton lines={3} />
          </div>
        </div>
        <Skeleton height={96} className="rounded-card" />
      </Section>
    </section>
  );
}

export function Gallery({ initialTheme = 'system' }: { initialTheme?: GalleryTheme }) {
  const [theme, setTheme] = useState<GalleryTheme>(initialTheme);
  const choose = (t: GalleryTheme) => {
    setTheme(t);
    applyTheme(t);
  };
  return (
    <ToastProvider>
      <div id="top" className="mx-auto min-h-dvh max-w-2xl pt-safe pb-safe px-safe">
        <header className="flex flex-col gap-3 px-gutter pt-6 pb-2">
          <h1 className="text-3xl font-bold">Design system</h1>
          <p className="text-fg-muted">
            Every component in every state, in both themes. The switch sets the page theme, which
            sheets and toasts follow.
          </p>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Page theme</legend>
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Button
                key={t}
                variant={theme === t ? 'primary' : 'secondary'}
                aria-pressed={theme === t}
                onClick={() => choose(t)}
              >
                {t[0]?.toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </fieldset>
        </header>
        <main className="flex flex-col gap-6 pb-10">
          <ThemeBlock theme="light" />
          <ThemeBlock theme="dark" />
        </main>
      </div>
    </ToastProvider>
  );
}
