// The text of the reader, virtualised without a library: sentences are grouped into chunks
// (buildChunks), and only the chunks near the visible part of the window are in the DOM.
// Heights of chunks never rendered are estimated from their length; rendered ones are
// measured. The page itself scrolls (the window), as on every other screen.
import type { TextAnalysis } from '@app/contracts';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type TokenStatus, TokenText } from '../../ui';
import {
  buildChunks,
  type Chunk,
  chunkOfSentence,
  type StatusMap,
  sentenceText,
  sentenceTokens,
} from './analysis';

/** Tokens per chunk: small enough that a screen holds a few chunks. */
export const CHUNK_TOKENS = 40;
/** Pixels rendered beyond the visible part, above and below. */
const OVERSCAN_PX = 600;
/** Upper bound of chunks in the DOM, whatever the measurements say. */
export const MAX_RENDERED_CHUNKS = 16;
/** Estimate before a chunk is measured: reading text at about 34 characters per 30 px line. */
const CHARS_PER_LINE = 34;
const LINE_PX = 30;
const PARAGRAPH_GAP_PX = 16;

function estimate(chunk: Chunk, index: number): number {
  return (
    Math.max(1, Math.ceil(chunk.chars / CHARS_PER_LINE)) * LINE_PX +
    (chunk.paragraph && index > 0 ? PARAGRAPH_GAP_PX : 0)
  );
}

export interface VirtualTextProps {
  body: string;
  analysis: TextAnalysis;
  statuses: StatusMap;
  /** Tokens shown as selected (a phrase being built). */
  selection?: { sentence: number; tokens: readonly number[] } | null;
  onTokenTap: (sentence: number, token: number) => void;
  /** Sentence to start at (the saved reading position). */
  initialSentence?: number;
  /** The first sentence in view, reported while the learner scrolls. */
  onPosition?: (sentence: number) => void;
  statusLabels?: Partial<Record<TokenStatus, string>>;
  label: string;
}

export function VirtualText({
  body,
  analysis,
  statuses,
  selection = null,
  onTokenTap,
  initialSentence = 0,
  onPosition,
  statusLabels,
  label,
}: VirtualTextProps) {
  const chunks = useMemo(() => buildChunks(analysis, body, CHUNK_TOKENS), [analysis, body]);
  const measured = useRef<number[]>([]);
  const elements = useRef(new Map<number, HTMLDivElement>());
  const container = useRef<HTMLElement>(null);
  const [version, setVersion] = useState(0);
  const startChunk = useMemo(
    () => chunkOfSentence(chunks, initialSentence),
    [chunks, initialSentence],
  );
  const [range, setRange] = useState<[number, number]>(() => [
    startChunk,
    Math.min(chunks.length - 1, startChunk + 5),
  ]);

  // `version` changes when a chunk was measured again.
  const offsets = useMemo(() => {
    const out = [0];
    chunks.forEach((c, i) => {
      out.push((out[i] as number) + (measured.current[i] || estimate(c, i)));
    });
    return out;
  }, [chunks, version]);
  const total = offsets[chunks.length] ?? 0;

  const update = useCallback(() => {
    const el = container.current;
    if (!el || chunks.length === 0) return;
    const top = el.getBoundingClientRect().top;
    const viewStart = -top - OVERSCAN_PX;
    const viewEnd = -top + window.innerHeight + OVERSCAN_PX;
    let start = 0;
    while (start < chunks.length - 1 && (offsets[start + 1] as number) <= viewStart) start++;
    let end = start;
    while (end < chunks.length - 1 && (offsets[end + 1] as number) < viewEnd) end++;
    end = Math.min(end, start + MAX_RENDERED_CHUNKS - 1);
    setRange((prev) => (prev[0] === start && prev[1] === end ? prev : [start, end]));
    if (onPosition) {
      for (const node of el.querySelectorAll<HTMLElement>('[data-sentence]')) {
        if (node.getBoundingClientRect().bottom > 0) {
          onPosition(Number(node.dataset.sentence));
          break;
        }
      }
    }
  }, [chunks, offsets, onPosition]);

  // Measure what is rendered; a changed height moves the chunks below it.
  useLayoutEffect(() => {
    let changed = false;
    for (const [i, node] of elements.current) {
      const h = node.offsetHeight;
      if (h > 0 && measured.current[i] !== h) {
        measured.current[i] = h;
        changed = true;
      }
    }
    if (changed) setVersion((v) => v + 1);
  });

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const onResize = () => {
      measured.current = [];
      setVersion((v) => v + 1);
      onScroll();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [update]);

  useEffect(() => {
    update();
  }, [update]);

  // Open at the saved position: jump near its chunk, then to the sentence once it renders.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (initialSentence <= 0 || !container.current) return;
    const top = container.current.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + (offsets[startChunk] ?? 0) });
    requestAnimationFrame(() => {
      container.current
        ?.querySelector(`[data-sentence="${initialSentence}"]`)
        ?.scrollIntoView({ block: 'start' });
    });
  }, []);

  const registers = useRef(new Map<number, (node: HTMLDivElement | null) => void>());
  const registerFor = (index: number) => {
    let fn = registers.current.get(index);
    if (!fn) {
      fn = (node) => {
        if (node) elements.current.set(index, node);
        else elements.current.delete(index);
      };
      registers.current.set(index, fn);
    }
    return fn;
  };

  const [first, last] = range;
  const visible = chunks.slice(first, last + 1);

  return (
    <section
      ref={container}
      aria-label={label}
      className="text-reading leading-relaxed"
      data-chunks={chunks.length}
    >
      <div aria-hidden="true" style={{ height: offsets[first] ?? 0 }} />
      {visible.map((chunk, k) => {
        const index = first + k;
        return (
          <ChunkView
            key={index}
            index={index}
            chunk={chunk}
            body={body}
            analysis={analysis}
            statuses={statuses}
            selection={
              selection && selection.sentence >= chunk.first && selection.sentence <= chunk.last
                ? selection
                : null
            }
            onTokenTap={onTokenTap}
            statusLabels={statusLabels}
            register={registerFor(index)}
          />
        );
      })}
      <div aria-hidden="true" style={{ height: total - (offsets[last + 1] ?? total) }} />
    </section>
  );
}

const ChunkView = memo(function ChunkView({
  index,
  chunk,
  body,
  analysis,
  statuses,
  selection,
  onTokenTap,
  statusLabels,
  register,
}: {
  index: number;
  chunk: Chunk;
  body: string;
  analysis: TextAnalysis;
  statuses: StatusMap;
  selection: VirtualTextProps['selection'];
  onTokenTap: VirtualTextProps['onTokenTap'];
  statusLabels: VirtualTextProps['statusLabels'];
  register: (node: HTMLDivElement | null) => void;
}) {
  const sentences: number[] = [];
  for (let n = chunk.first; n <= chunk.last; n++) sentences.push(n);
  return (
    <div
      ref={register}
      data-chunk={index}
      className={chunk.paragraph && index > 0 ? 'pt-4' : undefined}
    >
      {sentences.map((n) => (
        <Fragment key={n}>
          <SentenceView
            n={n}
            body={body}
            analysis={analysis}
            statuses={statuses}
            selected={selection?.sentence === n ? selection.tokens : undefined}
            onTokenTap={onTokenTap}
            statusLabels={statusLabels}
          />{' '}
        </Fragment>
      ))}
    </div>
  );
});

function SentenceView({
  n,
  body,
  analysis,
  statuses,
  selected,
  onTokenTap,
  statusLabels,
}: {
  n: number;
  body: string;
  analysis: TextAnalysis;
  statuses: StatusMap;
  selected: readonly number[] | undefined;
  onTokenTap: VirtualTextProps['onTokenTap'];
  statusLabels: VirtualTextProps['statusLabels'];
}) {
  const sentence = analysis.sentences[n];
  const tokens = useMemo(
    () => (sentence ? sentenceTokens(sentence, statuses) : []),
    [sentence, statuses],
  );
  const tap = useCallback((i: number) => onTokenTap(n, i), [n, onTokenTap]);
  if (!sentence) return null;
  return (
    <span data-sentence={n}>
      <TokenText
        as="span"
        text={sentenceText(body, sentence)}
        tokens={tokens}
        onTokenTap={tap}
        {...(selected ? { selected } : {})}
        {...(statusLabels ? { statusLabels } : {})}
      />
    </span>
  );
}
