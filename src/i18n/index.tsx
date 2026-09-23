import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { getPack, LOCALES, type LocaleKey, type LocaleMeta } from './locales';
import { en } from './locales';

const KEY = 'aiml:lang';

let lang = localStorage.getItem(KEY) || 'hinglish';
const listeners = new Set<() => void>();

export function setLang(code: string) {
  lang = code;
  try { localStorage.setItem(KEY, code); } catch { /* keep in-memory */ }
  document.documentElement.lang = code;
  document.documentElement.dir = LOCALES.find((l) => l.code === code)?.dir ?? 'ltr';
  listeners.forEach((l) => l());
}
// apply stored choice on boot
document.documentElement.lang = lang;
document.documentElement.dir = LOCALES.find((l) => l.code === lang)?.dir ?? 'ltr';

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

interface I18n {
  lang: string;
  t: (k: LocaleKey) => string;
  locales: LocaleMeta[];
  setLang: (c: string) => void;
}

const Ctx = createContext<I18n | null>(null);

function useLangSync(): string {
  return useSyncExternalStore(subscribe, () => lang, () => lang);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const current = useLangSync();
  const value = useMemo<I18n>(() => {
    const pack = getPack(current);
    return {
      lang: current,
      locales: LOCALES,
      setLang,
      t: (k: LocaleKey) => pack[k] ?? en[k],
    };
  }, [current]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
