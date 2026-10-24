import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Section, Extras } from '../../types';
import { CurriculumLoader } from '../../components/ui/CurriculumLoader';
import { useI18n } from '../../app/i18n';
import { loadSectionsOverlay, localizeSections } from './curriculum-i18n';

export const useCurriculumData = () => {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [overlay, setOverlay] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    const load = async <T,>(file: string): Promise<T> => {
      const response = await fetch(`./generated/curriculum/${file}`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${file} returned HTTP ${response.status}`);
      return response.json() as Promise<T>;
    };
    // The bilingual overlay is optional: a failure resolves to `null` (English titles) rather than
    // breaking the curriculum load, so a missing translation can never take the app down.
    Promise.all([load<Section[]>('sections.json'), load<Extras>('extras.json')])
      .then(([s, e]) => {
        if (alive) { setSections(s); setExtras(e); }
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'Unknown curriculum loading error.');
      });
    loadSectionsOverlay().then((value) => { if (alive) setOverlay(value); });
    return () => { alive = false; };
  }, [attempt]);
  return { sections, extras, overlay, error, retry: () => setAttempt((value) => value + 1) };
};

const Ctx = createContext<{ sections: Section[]; extras: Extras } | null>(null);

export function CurriculumProvider({ children }: { children: ReactNode }) {
  const { sections, extras, overlay, error, retry } = useCurriculumData();
  const [showLoader, setShowLoader] = useState(true);
  const { locale } = useI18n();

  /**
   * THE localization boundary for section data: every consumer below gets a plain string `title`,
   * exactly as it did before this existed. The raw sections stay cached and untouched, so switching
   * language re-derives titles without re-fetching (or re-parsing) the 1 MB curriculum.
   */
  const localized = useMemo(
    () => (sections ? localizeSections(sections, locale, overlay) : sections),
    [sections, locale, overlay],
  );

  if (!localized || !extras) {
    return <CurriculumLoader error={error} onRetry={retry} />;
  }
  return (
    <Ctx.Provider value={{ sections: localized, extras }}>
      {children}
      {showLoader && <CurriculumLoader ready onComplete={() => setShowLoader(false)} />}
    </Ctx.Provider>
  );
}

export function useCurriculum() {
  const v = useContext(Ctx);
  if (!v) throw new Error('Curriculum not loaded');
  return v;
}

export const sectionById = (sections: Section[], id: string | undefined) => sections.find((s) => s.id === id);
