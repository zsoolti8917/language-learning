// The theme setting: `profile.settings.theme` = 'system' | 'light' | 'dark'. The design system
// switches by `data-theme` on <html> (unset follows the system). The choice is also kept in
// localStorage (`THEME_KEY`) so the shell could apply it before the first paint.
import type { Profile } from '@app/contracts';
import { useEffect } from 'react';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = 'app.theme';

export function themeOf(profile: Pick<Profile, 'settings'> | undefined): Theme {
  const v = profile?.settings?.theme;
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Blocked storage: the profile still holds the choice.
  }
}

/** Applies the profile's theme while the screen is shown and whenever it changes. */
export function useProfileTheme(profile: Pick<Profile, 'settings'> | undefined): void {
  const theme = profile ? themeOf(profile) : undefined;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}
