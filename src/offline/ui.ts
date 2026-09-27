/**
 * Persisted UI preferences (sidebar collapse, focus mode).
 *
 * Lives outside React so the dashboard's Focus Mode tile and the shell's
 * sidebar handle stay in sync without prop drilling or a reload.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'aiml:ui:v1';

export interface UiPrefs {
  navCollapsed: boolean;
  focus: boolean;
}

const DEFAULTS: UiPrefs = { navCollapsed: false, focus: false };

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      navCollapsed: typeof parsed?.navCollapsed === 'boolean' ? parsed.navCollapsed : DEFAULTS.navCollapsed,
      focus: typeof parsed?.focus === 'boolean' ? parsed.focus : DEFAULTS.focus,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs: UiPrefs = load();
const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiPrefs>) {
  prefs = { ...prefs, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* quota — keep in memory */ }
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
