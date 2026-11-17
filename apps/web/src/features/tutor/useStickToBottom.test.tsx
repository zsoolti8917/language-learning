import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useStickToBottom } from './useStickToBottom';

/** jsdom has no layout: the list's sizes are set by hand, as a growing reply would change them. */
function fakeLayout(el: HTMLElement, size: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => size.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => size.clientHeight });
}

function List({
  version,
  onReady,
}: {
  version: number;
  onReady?: (api: { toBottom(): void }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useStickToBottom(ref, version);
  onReady?.(s);
  return <div ref={ref} data-testid="list" onScroll={s.onScroll} />;
}

describe('useStickToBottom', () => {
  it('follows a growing reply while the learner is at the bottom', () => {
    const { getByTestId, rerender } = render(<List version={0} />);
    const el = getByTestId('list');
    const size = { scrollHeight: 1000, clientHeight: 400 };
    fakeLayout(el, size);
    for (let v = 1; v <= 5; v++) {
      size.scrollHeight += 120;
      rerender(<List version={v} />);
      expect(el.scrollTop).toBe(size.scrollHeight);
    }
  });

  it('stays put once the learner scrolled up, and follows again back at the bottom', () => {
    const { getByTestId, rerender } = render(<List version={0} />);
    const el = getByTestId('list');
    const size = { scrollHeight: 1000, clientHeight: 400 };
    fakeLayout(el, size);
    rerender(<List version={1} />);

    el.scrollTop = 100;
    fireEvent.scroll(el);
    size.scrollHeight = 1400;
    rerender(<List version={2} />);
    expect(el.scrollTop).toBe(100);

    // Back down (within the slack of the bottom).
    el.scrollTop = 1400 - 400 - 20;
    fireEvent.scroll(el);
    size.scrollHeight = 1600;
    rerender(<List version={3} />);
    expect(el.scrollTop).toBe(1600);
  });

  it('jumps to the bottom when the learner sends a message', () => {
    let api: { toBottom(): void } | undefined;
    const { getByTestId } = render(
      <List
        version={0}
        onReady={(a) => {
          api = a;
        }}
      />,
    );
    const el = getByTestId('list');
    fakeLayout(el, { scrollHeight: 2000, clientHeight: 400 });
    el.scrollTop = 0;
    fireEvent.scroll(el);
    api?.toBottom();
    expect(el.scrollTop).toBe(2000);
  });
});
