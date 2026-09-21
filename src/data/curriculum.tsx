import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Section, Extras } from '../types';

export const useCurriculumData = () => {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('./curriculum/sections.json').then((r) => r.json()),
      fetch('./curriculum/extras.json').then((r) => r.json()),
    ]).then(([s, e]) => { if (alive) { setSections(s); setExtras(e); } });
    return () => { alive = false; };
  }, []);
  return { sections, extras };
};

const Ctx = createContext<{ sections: Section[]; extras: Extras } | null>(null);

export function CurriculumProvider({ children }: { children: ReactNode }) {
  const { sections, extras } = useCurriculumData();
  if (!sections || !extras) return <div className="loading">Loading curriculum…</div>;
  return <Ctx.Provider value={{ sections, extras }}>{children}</Ctx.Provider>;
}

export function useCurriculum() {
  const v = useContext(Ctx);
  if (!v) throw new Error('Curriculum not loaded');
  return v;
}

export const sectionById = (sections: Section[], id: string | undefined) => sections.find((s) => s.id === id);
