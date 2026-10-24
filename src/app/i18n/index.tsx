import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_LOCALE,
  getPack,
  LOCALES,
  missingLocaleKeys,
  normalizeLocale,
  type LocaleId,
  type LocaleKey,
  type LocaleMeta,
} from './locales';

/**
 * The language switch, and the rules that keep it honest.
 *
 * One id ('en' | 'hi') drives everything: the message packs, `document.lang`/`dir`, the language
 * selector and — through `useI18n().locale` — every surface that has to pick a language out of
 * content (see `core/data/localize.ts`). Components never compare language codes to choose copy;
 * they ask `t()` for a key, and the pack decides.
 */

/** The stored choice. Unchanged since the first release, so a saved preference survives the rename. */
const KEY = 'aiml:lang';

/**
 * A stored EXPLICIT choice, or English.
 *
 * Browser-language detection is deliberately absent: English is the official default, so a first
 * visit must be English even when the browser itself is configured for Hindi. Only `setLang` writes
 * the key, which means a stored value is always a real user decision and is safe to restore later.
 */
function initialLocale(): LocaleId {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked (private mode, a locked-down profile): the default still applies.
  }
  return normalizeLocale(stored) ?? DEFAULT_LOCALE;
}

function applyDocument(next: LocaleId) {
  document.documentElement.lang = next;
  document.documentElement.dir = LOCALES.find((l) => l.code === next)?.dir ?? 'ltr';
}

let locale = initialLocale();
applyDocument(locale);

const listeners = new Set<() => void>();

/**
 * Missing keys are REPORTED, never hidden — but only in development, and only once per key: the
 * pack falls back to English so a learner never sees a raw `fallback.nav.courses`, and a developer
 * still finds out the moment a string is added to one pack and forgotten in the other.
 * `npm run i18n:check` is the build-time half of the same rule.
 */
const reported = new Set<string>();

function reportMissing(code: LocaleId) {
  for (const key of missingLocaleKeys(code)) {
    const id = `${code}:${key}`;
    if (reported.has(id)) continue;
    reported.add(id);
    console.warn(`[BroCode i18n] "${key}" has no ${code} translation; the English string is shown.`);
  }
}

if (import.meta.env.DEV) reportMissing(locale);

/** `{count}` and friends are substituted as plain text — never parsed as markup. */
export type TranslateVars = Record<string, string | number>;

function translate(pack: ReturnType<typeof getPack>, key: LocaleKey, vars?: TranslateVars): string {
  const message = pack[key] ?? getPack('en')[key] ?? key;
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  ));
}

export function setLang(code: string) {
  const next = normalizeLocale(code) ?? DEFAULT_LOCALE;
  locale = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // In-memory only; the choice just will not survive a reload.
  }
  applyDocument(next);
  if (import.meta.env.DEV) reportMissing(next);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

interface I18n {
  /** The active locale id — what content localization reads. */
  locale: LocaleId;
  /** Kept for the call sites that already read `lang`; same value as `locale`. */
  lang: LocaleId;
  t: (k: LocaleKey, vars?: TranslateVars) => string;
  locales: LocaleMeta[];
  setLang: (c: string) => void;
}

const Ctx = createContext<I18n | null>(null);

function useLangSync(): LocaleId {
  return useSyncExternalStore(subscribe, () => locale, () => locale);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const current = useLangSync();
  const value = useMemo<I18n>(() => {
    const pack = getPack(current);
    return {
      locale: current,
      lang: current,
      locales: LOCALES,
      setLang,
      t: (key: LocaleKey, vars?: TranslateVars) => translate(pack, key, vars),
    };
  }, [current]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}

export { LOCALES };
export type { LocaleId, LocaleKey, LocaleMeta };
