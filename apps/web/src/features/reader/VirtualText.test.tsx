import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChunks } from './analysis';
import { longText } from './fixtures';
import { CHUNK_TOKENS, MAX_RENDERED_CHUNKS, VirtualText } from './VirtualText';

/** About 2,000 tokens: 445 sentences of 4 or 5 tokens. */
const { body, analysis } = longText(445);
const TOKENS = analysis.sentences.reduce((n, s) => n + s.tokens.length, 0);

function renderText(onTokenTap = vi.fn()) {
  const result = render(
    <VirtualText
      body={body}
      analysis={analysis}
      statuses={{ '21': 'learning', '64': 'known' }}
      onTokenTap={onTokenTap}
      label="Text"
    />,
  );
  const section = result.getByRole('region', { name: 'Text' });
  return { ...result, section, onTokenTap };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VirtualText', () => {
  it('renders a text of 2,000 tokens with a bounded number of DOM nodes', () => {
    expect(TOKENS).toBeGreaterThanOrEqual(2_000);
    const { section } = renderText();
    const chunks = buildChunks(analysis, body, CHUNK_TOKENS);
    const rendered = section.querySelectorAll('[data-chunk]');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThanOrEqual(MAX_RENDERED_CHUNKS);
    expect(rendered.length).toBeLessThan(chunks.length / 4);
    // Far fewer nodes than one per token, and the end of the text is not in the DOM.
    const tokens = section.querySelectorAll('[data-token], [data-status]');
    expect(tokens.length).toBeLessThan(TOKENS / 4);
    expect(section.querySelectorAll('*').length).toBeLessThan(1_500);
    expect(section.querySelector(`[data-sentence="${analysis.sentences.length - 1}"]`)).toBeNull();
    // Spacers keep the full height, so the scroll bar matches the whole text.
    const spacers = [...section.children].filter((c) => c.getAttribute('aria-hidden') === 'true');
    expect(spacers).toHaveLength(2);
    const bottom = Number.parseFloat((spacers[1] as HTMLElement).style.height);
    expect(bottom).toBeGreaterThan(5_000);
  });

  it('renders the chunks near the window as the learner scrolls', () => {
    const { section } = renderText();
    const lastSentence = analysis.sentences.length - 1;
    // Scroll to the end: the section's top moves far above the window.
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({
      top: -1_000_000,
      bottom: 0,
      left: 0,
      right: 390,
      width: 390,
      height: 0,
      x: 0,
      y: -1_000_000,
      toJSON: () => ({}),
    });
    act(() => {
      fireEvent.scroll(window);
    });
    // The scroll handler runs in the next animation frame.
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          expect(section.querySelector(`[data-sentence="${lastSentence}"]`)).not.toBeNull();
          expect(section.querySelector('[data-sentence="0"]')).toBeNull();
          expect(section.querySelectorAll('[data-chunk]').length).toBeLessThanOrEqual(
            MAX_RENDERED_CHUNKS,
          );
          resolve();
        }, 0);
      });
    });
  });

  it('shows each word with its status, and taps report sentence and token', () => {
    const { section, onTokenTap } = renderText();
    const first = section.querySelector('[data-sentence="1"]');
    const kina = first?.querySelector('[data-token="3"]') as HTMLElement;
    expect(kina).toHaveTextContent('kina');
    expect(kina).toHaveAttribute('data-status', 'learning');
    expect(section.querySelector('[data-sentence="0"] [data-token="0"]')).toHaveAttribute(
      'data-status',
      'known',
    );
    fireEvent.click(kina);
    expect(onTokenTap).toHaveBeenCalledWith(1, 3);
    // The full stop is plain text, not a button.
    const stops = [...(first?.querySelectorAll('span') ?? [])].filter((s) => s.textContent === '.');
    expect(stops.length).toBeGreaterThan(0);
    expect(first?.querySelectorAll('button')).toHaveLength(4);
  });
});
