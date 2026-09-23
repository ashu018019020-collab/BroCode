import { useEffect, useState } from 'react';

/** Chapter = one curriculum section; topic = one concept inside it. */
export interface TrackTopic {
  id: string;
  title: string;
  sectionId: string;
  importance: string;
  level: string;
  hasCode: boolean;
}
export interface TrackChapter {
  id: string;
  number: number;
  title: string;
  pdfPage: number | null;
  counts: { concepts: number; interview: number; coding: number; logic: number; solved: number; projects: number; checkpoint: number };
  topics: TrackTopic[];
}
export interface TrackDoc {
  id: string;          // slug, e.g. "python-core"
  number: number;
  key: string;         // legacy TRACK_DEFS key, e.g. "python"
  title: string;
  description: string;
  estimatedHours: number;
  unlocked: true;      // all tracks are always open — enforced by data + validator
  recommendedPrerequisites: string[];
  sectionRange: { from: number; to: number };
  chapters: TrackChapter[];
}
export interface TrackIndexEntry { slug: string; title: string; chapters: number; topics: number }

export function useTrackIndex(): TrackIndexEntry[] | null {
  const [idx, setIdx] = useState<TrackIndexEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('./tracks/index.json').then((r) => r.json()).then((d) => { if (alive) setIdx(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return idx;
}

/** Lazy per-track loader — only the opened track's JSON is fetched. */
export function useTrackDoc(slug: string | undefined): TrackDoc | null {
  const [doc, setDoc] = useState<TrackDoc | null>(null);
  useEffect(() => {
    if (!slug) { setDoc(null); return; }
    let alive = true;
    setDoc(null);
    fetch(`./tracks/${slug}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setDoc(d); })
      .catch(() => { if (alive) setDoc(null); });
    return () => { alive = false; };
  }, [slug]);
  return doc;
}
