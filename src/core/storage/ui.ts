/**
 * Persisted UI preferences (sidebar collapse, focus mode, theme).
 *
 * Lives outside React so the dashboard's Focus Mode tile, the header's switches and the shell's
 * sidebar handle stay in sync without prop drilling or a reload.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'aiml:ui:v1';

/**
 * "The learner actually picked a theme."
 *
 * Written ONLY by `setUi({ theme })`. Its existence is what separates a real choice from the old
 * default: before this app defaulted to light, not storing a theme meant dark, so every existing
 * learner has `theme: 'dark'` captured implicitly. Honouring that as a decision would leave everyone
 * on dark and make the new default invisible. A separate marker key is used instead of a new field
 * inside `aiml:ui:v1` so a stored value keeps its exact previous shape and nothing has to migrate.
 */
const CHOICE_KEY = 'aiml:theme:choice';

export type Theme = 'dark' | 'light';

export interface UiPrefs {
  navCollapsed: boolean;
  focus: boolean;
  theme: Theme;
}

/**
 * LIGHT is the product default. A learner who wants dark picks it from the header toggle or the
 * quick-actions menu and that choice is then remembered for good.
 */
const DEFAULTS: UiPrefs = { navCollapsed: false, focus: false, theme: 'light' };

/** The learner's own choice, if they ever made one. Never throws: blocked storage means "no choice". */
export function themeChoice(): Theme | null {
  try {
    if (localStorage.getItem(CHOICE_KEY) !== '1') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.theme === 'light' || parsed?.theme === 'dark' ? parsed.theme : null;
  } catch {
    return null;
  }
}

/**
 * The theme a fresh start should use.
 *
 * Precedence: an explicit stored choice → the product default (light). A stored `dark` with no
 * choice marker is the pre-light default, NOT a decision, so it resolves to light — this is the one
 * behaviour change here, and it is what makes the request ("always start in light mode") true for
 * learners who already have state.
 */
export function resolveTheme(): Theme {
  return themeChoice() ?? DEFAULTS.theme;
}

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, theme: resolveTheme() };
    const parsed = JSON.parse(raw);
    return {
      navCollapsed: typeof parsed?.navCollapsed === 'boolean' ? parsed.navCollapsed : DEFAULTS.navCollapsed,
      focus: typeof parsed?.focus === 'boolean' ? parsed.focus : DEFAULTS.focus,
      theme: resolveTheme(),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs: UiPrefs = load();
const listeners = new Set<() => void>();

/**
 * The theme is an ATTRIBUTE on <html>, not per-component state: every surface reads one token set,
 * so switching is one write and no re-render of the tree below.
 *
 * It runs at module load, but that is NOT early enough to be the only place it runs — the module
 * graph loads after the document has painted once. `index.html` therefore carries the same rule as a
 * tiny inline boot script, which sets the attribute before the first paint. This function keeps the
 * attribute correct afterwards (a toggle, a storage change) and owns `theme-color` so a phone's
 * status bar follows the page instead of being pinned to a dark hex in the markup.
 */
const THEME_COLOR: Record<Theme, string> = { dark: '#0a0a0a', light: '#f2f4fa' };

export function applyTheme() {
  const el = document.documentElement;
  el.dataset.theme = prefs.theme;
  el.style.colorScheme = prefs.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[prefs.theme]);
}
applyTheme();

export function setUi(patch: Partial<UiPrefs>) {
  prefs = { ...prefs, ...patch };
  // Choosing a theme is recorded as a CHOICE, so a later release cannot mistake it for a default.
  if (patch.theme) {
    try { localStorage.setItem(CHOICE_KEY, '1'); } catch { /* quota — keep in memory */ }
  }
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
