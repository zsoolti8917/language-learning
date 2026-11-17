// Keeps a scrolling list at its bottom while content grows, unless the learner scrolled up.
import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';

/** Distance in pixels from the bottom that still counts as "at the bottom". */
export const BOTTOM_SLACK = 48;

export function isAtBottom(el: HTMLElement, slack = BOTTOM_SLACK): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

/**
 * `ref` is the scroll container. Whenever `version` changes (a new message, a delta), the list
 * follows the bottom if it was there at the learner's last scroll. Returns `onScroll` for the
 * container and `toBottom()` to jump down (after the learner sends a message).
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, version: unknown) {
  // Read only on scroll events: when content grows, the old position is the one that counts.
  const stick = useRef(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) stick.current = isAtBottom(el);
  }, [ref]);

  const toBottom = useCallback(() => {
    const el = ref.current;
    stick.current = true;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ref]);

  // `version` is the trigger: it changes whenever the content grows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [ref, version]);

  return { onScroll, toBottom, isStuck: () => stick.current };
}
