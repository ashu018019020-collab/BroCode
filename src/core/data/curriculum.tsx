import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Section, Extras } from '../../types';
import { CurriculumLoader } from '../../components/ui/CurriculumLoader';

export const useCurriculumData = () => {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
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
    Promise.all([load<Section[]>('sections.json'), load<Extras>('extras.json')])
      .then(([s, e]) => {
        if (alive) { setSections(s); setExtras(e); }
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'Unknown curriculum loading error.');
      });
    return () => { alive = false; };
  }, [attempt]);
  return { sections, extras, error, retry: () => setAttempt((value) => value + 1) };
};

const Ctx = createContext<{ sections: Section[]; extras: Extras } | null>(null);

export function CurriculumProvider({ children }: { children: ReactNode }) {
  const { sections, extras, error, retry } = useCurriculumData();
  const [showLoader, setShowLoader] = useState(true);
  if (!sections || !extras) {
    return <CurriculumLoader error={error} onRetry={retry} />;
  }
  return (
    <Ctx.Provider value={{ sections, extras }}>
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
