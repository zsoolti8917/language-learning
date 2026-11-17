import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  shouldShowIosInstallHint,
  swEvents,
  useIosInstallHint,
  useOnline,
  useUpdatePrompt,
} from '.';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36';

describe('iOS install hint', () => {
  it('shows only in iOS Safari outside the installed app', () => {
    expect(shouldShowIosInstallHint({ userAgent: IPHONE_SAFARI })).toBe(true);
    expect(shouldShowIosInstallHint({ userAgent: IPHONE_SAFARI, standalone: true })).toBe(false);
    expect(shouldShowIosInstallHint({ userAgent: IPHONE_SAFARI, displayStandalone: true })).toBe(
      false,
    );
    expect(shouldShowIosInstallHint({ userAgent: IPHONE_CHROME })).toBe(false);
    expect(shouldShowIosInstallHint({ userAgent: ANDROID })).toBe(false);
    // iPadOS reports a Mac.
    expect(
      shouldShowIosInstallHint({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/19.1 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('is shown once: dismiss is remembered', () => {
    const first = renderHook(() => useIosInstallHint({ userAgent: IPHONE_SAFARI }));
    expect(first.result.current.show).toBe(true);
    act(() => first.result.current.dismiss());
    expect(first.result.current.show).toBe(false);
    const again = renderHook(() => useIosInstallHint({ userAgent: IPHONE_SAFARI }));
    expect(again.result.current.show).toBe(false);
  });
});

describe('update prompt', () => {
  it('shows when a new version waits, and update activates it', async () => {
    swEvents.reset();
    const update = vi.fn(async () => {});
    swEvents.setUpdater(update);
    const { result } = renderHook(() => useUpdatePrompt());
    expect(result.current.needRefresh).toBe(false);
    act(() => swEvents.needRefresh());
    expect(result.current.needRefresh).toBe(true);
    await act(() => result.current.update());
    expect(update).toHaveBeenCalledOnce();
    act(() => result.current.dismiss());
    expect(result.current.needRefresh).toBe(false);
    act(() => swEvents.offlineReady());
    expect(result.current.offlineReady).toBe(true);
  });
});

describe('connection', () => {
  it('follows online and offline events', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    onLine.mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
    onLine.mockRestore();
  });
});
