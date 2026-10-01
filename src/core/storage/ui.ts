/**
 * Persisted UI preferences (sidebar collapse, focus mode, theme).
 *
 * Lives outside React so the dashboard's Focus Mode tile, the header's switches and the shell's
 * sidebar handle stay in sync without prop drilling or a reload.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'aiml:ui:v1';

export type Theme = 'dark' | 'light';

export interface UiPrefs {
  navCollapsed: boolean;
  focus: boolean;
  theme: Theme;
}

/** Dark is the default — the app shipped dark, and a stored choice is what switches it. */
const DEFAULTS: UiPrefs = { navCollapsed: false, focus: false, theme: 'dark' };

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      navCollapsed: typeof parsed?.navCollapsed === 'boolean' ? parsed.navCollapsed : DEFAULTS.navCollapsed,
      focus: typeof parsed?.focus === 'boolean' ? parsed.focus : DEFAULTS.focus,
      theme: parsed?.theme === 'light' || parsed?.theme === 'dark' ? parsed.theme : DEFAULTS.theme,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs: UiPrefs = load();
const listeners = new Set<() => void>();

/**
 * The theme is an ATTRIBUTE on <html>, not per-component state: every surface reads one token set,
 * so switching is one write and no re-render of the tree below. It runs at module load — before
 * React's first paint, because `main.tsx` imports the shell that imports this file — so a stored
 * light theme never flashes dark first. `color-scheme` rides along so the native pieces (scrollbars,
 * textarea resize handle, focus rings on form controls) follow without a rule each.
 */
export function applyTheme() {
  const el = document.documentElement;
  el.dataset.theme = prefs.theme;
  el.style.colorScheme = prefs.theme;
}
applyTheme();

export function setUi(patch: Partial<UiPrefs>) {
  prefs = { ...prefs, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* quota — keep in memory */ }
  if (patch.theme) applyTheme();
  for (const l of listeners) l();
}

export function toggleFocus() { setUi({ focus: !prefs.focus }); }

export function useUi(): UiPrefs {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => prefs,
    () => prefs,
  );
}
