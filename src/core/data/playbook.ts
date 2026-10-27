import { useEffect, useMemo, useState } from 'react';
import { useCurriculum } from './curriculum';
import { useStore } from '../storage/store';
import { bankCleared, bankTouched } from '../learning/coverage';
import {
  trackCoverage, nextPlaybookTarget, playbookPractised,
  type PbIndex, type PbItem, type PbTrackDef, type PbTrackRow, type PbTarget,
} from '../assessment/playbook';

export type { PbIndex, PbItem, PbChapter, PbTotals, PbTrackRow, PbTarget, PbTrackDef } from '../assessment/playbook';

/**
 * The bundled content pack's lazy JSON.
 *
 * Each file is fetched at most ONCE per session, because the promise itself is cached at module
 * level rather than the result: two surfaces on one page (the Playbook band and the path cards)
 * both ask for items.json, and 192 KB should not be fetched twice. Every file here is part of the
 * bundled pack, so the cached copy is also what makes the Learning Path work with no network —
 * `Public/sw.js` keeps `/playbook`, `/questions` and `/notebooks` JSON in its content cache.
 */
let indexPromise: Promise<PbIndex | null> | null = null;
let itemsPromise: Promise<{ count: number; items: PbItem[] } | null> | null = null;
let publishedPromise: Promise<{ total: number; sections: number; interview: number } | null> | null = null;
let notebooksPromise: Promise<{ notebooks: number; cells: number } | null> | null = null;

const loadJson = <T,>(url: string, fail: () => T): Promise<T> =>
  fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((d: T) => d).catch(fail);

export const loadPlaybookIndex = () => (indexPromise ??= loadJson<PbIndex | null>('./generated/playbook/manifest.json', () => null));
export const loadPlaybookItems = () =>
  (itemsPromise ??= loadJson<{ count: number; items: PbItem[] } | null>('./generated/playbook/items.json', () => null));

/** Only the two columns of the bank manifest the path needs — the file itself is much richer. */
interface BankManifestLite { total: number; sections: { byType?: Record<string, number> }[] }
interface NotebookManifestLite { notebooks: { cells?: number }[] }

/** Published question count + the interview slice, read from the bank manifest, never hard-coded. */
export const loadPublished = () =>
  (publishedPromise ??= loadJson<BankManifestLite | null>('./generated/questions/manifest.json', () => null).then((m) => {
    if (!m?.sections) return null;
    const interview = m.sections.reduce((a, b) => a + (b.byType?.interview ?? 0), 0);
    return { total: m.total, sections: m.sections.length, interview };
  }));

/** Notebook count + total cells: the denominator for "cells run" on the Notebook Lab card. */
export const loadNotebooks = () =>
  (notebooksPromise ??= loadJson<NotebookManifestLite | null>('./notebooks/manifest.json', () => null).then((m) => {
    const list = m?.notebooks;
    if (!list) return null;
    return { notebooks: list.length, cells: list.reduce((a, n) => a + (n.cells ?? 0), 0) };
  }));

/** Small "load once, render when ready" hook — `load` must be one of the cached loaders above. */
export function useAsync<T>(load: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((d) => { if (alive) setValue(d); });
    return () => { alive = false; };
  }, [load]);
  return value;
}

export function usePlaybookIndex() {
  return useAsync(loadPlaybookIndex);
}

export function usePlaybookItems() {
  return useAsync(loadPlaybookItems);
}

export interface PlaybookCoverage {
  index: PbIndex | null;
  items: PbItem[] | null;
  rows: PbTrackRow[];
  touched: number;
  total: number;
  target: PbTarget | null;
  /** False until items.json has arrived — the band shows its own loading state, never zeros. */
  ready: boolean;
}

/**
 * The V15 layer of the Learning Path: one row per track plus the next best section to open.
 *
 * `tracks` is passed in rather than imported, so this data module never has to reach into
 * App.tsx for TRACK_DEFS (and the maths stays in the tested engine module).
 */
export function usePlaybookCoverage(tracks: PbTrackDef[]): PlaybookCoverage {
  const index = usePlaybookIndex();
  const items = usePlaybookItems();
  const { sections } = useCurriculum();
  const state = useStore();
  const attempts = state.attempts;

  return useMemo(() => {
    const list = items?.items ?? null;
    // The counts ask "was it done" (a failed item counts); the ladder asks "is it dealt with" (a
    // failed item does not, so the section it belongs to stays the next target).
    const isPractised = (id: string) => bankTouched(attempts, id);
    const isCleared = (id: string) => bankCleared(attempts, id);
    const rows = trackCoverage(index, list, sections, tracks, isPractised);
    return {
      index,
      items: list,
      rows,
      touched: playbookPractised(list, isPractised),
      total: list?.length ?? index?.totals.items ?? 0,
      target: nextPlaybookTarget(index, list, sections, isCleared),
      ready: !!list,
    };
  }, [index, items, sections, attempts, tracks]);
}
