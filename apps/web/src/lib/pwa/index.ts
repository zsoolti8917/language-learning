// Service worker updates, the iOS install hint and the connection state.
// The service worker caches the app shell only; API data lives in the local database.
import { useCallback, useState, useSyncExternalStore } from 'react';

// --- Update prompt ------------------------------------------------------------------------

interface UpdateState {
  /** A new version is installed and waits; show the prompt. */
  needRefresh: boolean;
  /** The shell is cached and the app opens offline from now on. */
  offlineReady: boolean;
}

let updateState: UpdateState = { needRefresh: false, offlineReady: false };
let applyUpdate: () => Promise<void> = async () => {};
const updateListeners = new Set<() => void>();

function setUpdateState(patch: Partial<UpdateState>) {
  updateState = { ...updateState, ...patch };
  for (const l of updateListeners) l();
}

/** Called by `registerServiceWorker` (and by tests) when the worker reports. */
export const swEvents = {
  needRefresh: () => setUpdateState({ needRefresh: true }),
  offlineReady: () => setUpdateState({ offlineReady: true }),
  setUpdater: (f: () => Promise<void>) => {
    applyUpdate = f;
  },
  reset: () => {
    applyUpdate = async () => {};
    setUpdateState({ needRefresh: false, offlineReady: false });
  },
};

/** Registers the service worker of vite-plugin-pwa. `main.tsx` calls it outside mock mode. */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  const update = registerSW({
    immediate: true,
    onNeedRefresh: swEvents.needRefresh,
    onOfflineReady: swEvents.offlineReady,
  });
  swEvents.setUpdater(() => update(true));
}

/**
 * For the update prompt (M1): `needRefresh` is true when a new version waits. `update()`
 * activates it and reloads; `dismiss()` hides the prompt until the next update.
 */
export function useUpdatePrompt(): UpdateState & {
  update: () => Promise<void>;
  dismiss: () => void;
} {
  const state = useSyncExternalStore(
    (l) => {
      updateListeners.add(l);
      return () => updateListeners.delete(l);
    },
    () => updateState,
    () => updateState,
  );
  return {
    ...state,
    update: () => applyUpdate(),
    dismiss: () => setUpdateState({ needRefresh: false }),
  };
}

// --- iOS install hint ---------------------------------------------------------------------

const HINT_KEY = 'app.iosInstallHintDismissed';

export interface PlatformInfo {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** Safari's `navigator.standalone`. */
  standalone?: boolean;
  /** `matchMedia('(display-mode: standalone)').matches` */
  displayStandalone?: boolean;
}

function currentPlatform(): PlatformInfo {
  if (typeof navigator === 'undefined') return { userAgent: '' };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as { standalone?: boolean }).standalone,
    displayStandalone:
      typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
  };
}

/** True on iPhone and iPad Safari when the app is not installed yet. */
export function shouldShowIosInstallHint(p: PlatformInfo): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(p.userAgent) ||
    (p.platform === 'MacIntel' && (p.maxTouchPoints ?? 0) > 1);
  // Other iOS browsers (Chrome, Firefox, Edge) cannot add to the home screen the same way.
  const safari = /Safari/.test(p.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(p.userAgent);
  const installed = p.standalone === true || p.displayStandalone === true;
  return ios && safari && !installed;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * For the one time Add to Home Screen hint on iOS (M1): `show` is true on iOS Safari outside
 * the installed app, until `dismiss()`.
 */
export function useIosInstallHint(platform: PlatformInfo = currentPlatform()): {
  show: boolean;
  dismiss: () => void;
} {
  const [dismissed, setDismissed] = useState(readDismissed);
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Blocked storage: the hint returns next visit, which is acceptable.
    }
    setDismissed(true);
  }, []);
  return { show: !dismissed && shouldShowIosInstallHint(platform), dismiss };
}

// --- Connection ---------------------------------------------------------------------------

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** `navigator.onLine`, live. For the offline indicator and to switch off online only actions. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
