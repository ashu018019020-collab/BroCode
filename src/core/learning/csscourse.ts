/**
 * The CSS Mastery course's pure rules.
 *
 * Same ten-section architecture as the C++ course, but its own storage family. A shared key would
 * let an CSS module complete a course module with the same number, so every record is
 * `cssmod:<module>:<section>` and nothing else can count it.
 *
 * Pure on purpose: no React, no store, no fetch, so the arithmetic is driven with fixtures under
 * `node --test`.
 */
import { N_SECTIONS, type NEntry, type NModule, type NSectionKey } from './ncourse';

export const H_LAST_KEY = 'csslast';

/** One completion record: the section of a module was worked through. */
export function hSectionKey(moduleId: string, section: NSectionKey): string {
  return `cssmod:${moduleId}:${section}`;
}

/** A written answer draft, per entry, so it survives a refresh. */
export function hWrittenKey(entryId: string): string {
  return `cssans:${entryId}`;
}

/** A module is complete when all ten sections have a record — never from a score. */
export function hIsModuleComplete(moduleId: string, attempts: Record<string, unknown>): boolean {
  return N_SECTIONS.every((s) => Boolean(attempts[hSectionKey(moduleId, s.key)]));
}

export interface HProgress {
  modulesDone: number;
  modulesTotal: number;
  pct: number;
  sectionsDone: number;
  sectionsTotal: number;
}

export function hProgress(modules: { id: string }[], attempts: Record<string, unknown>): HProgress {
  const total = modules.length * N_SECTIONS.length;
  let sectionsDone = 0;
  let modulesDone = 0;
  for (const m of modules) {
    const done = N_SECTIONS.filter((s) => Boolean(attempts[hSectionKey(m.id, s.key)])).length;
    sectionsDone += done;
    if (done === N_SECTIONS.length) modulesDone += 1;
  }
  return {
    modulesDone,
    modulesTotal: modules.length,
    pct: total > 0 ? Math.round((sectionsDone / total) * 100) : 0,
    sectionsDone,
    sectionsTotal: total,
  };
}

export interface HReportRow {
  id: string;
  no: number;
  title: string;
  done: number;
  total: number;
  pct: number;
}

export interface HReport extends HProgress {
  rows: HReportRow[];
  next: { moduleId: string; section: NSectionKey } | null;
  resume: { moduleId: string; section: NSectionKey } | null;
}

/** The first section with something left in it — what "Continue" opens. */
export function hNextSection(moduleId: string, attempts: Record<string, unknown>): NSectionKey {
  return N_SECTIONS.find((s) => !attempts[hSectionKey(moduleId, s.key)])?.key ?? 'checkpoint';
}

/** Per-module report, the next untouched place and the stored resume point. */
export function hReport(modules: NModule[], attempts: Record<string, unknown>, last?: string): HReport {
  const rows: HReportRow[] = [];
  let sectionsDone = 0;
  for (const m of modules) {
    const recorded = N_SECTIONS.filter((s) => Boolean(attempts[hSectionKey(m.id, s.key)])).length;
    sectionsDone += recorded;
    rows.push({
      id: m.id, no: m.no, title: m.title, done: recorded, total: N_SECTIONS.length,
      pct: Math.round((recorded / N_SECTIONS.length) * 100),
    });
  }
  const sectionsTotal = modules.length * N_SECTIONS.length;
  const modulesDone = rows.filter((r) => r.done === r.total).length;
  const fresh = modules.find((m) => !hIsModuleComplete(m.id, attempts));
  const next = fresh ? { moduleId: fresh.id, section: hNextSection(fresh.id, attempts) } : null;
  let resume: HReport['resume'] = null;
  if (last) {
    const [moduleId, section] = last.split(':');
    if (modules.some((m) => m.id === moduleId) && N_SECTIONS.some((s) => s.key === section)) {
      resume = { moduleId, section: section as NSectionKey };
    }
  }
  return {
    modulesDone,
    modulesTotal: modules.length,
    sectionsDone,
    sectionsTotal,
    pct: sectionsTotal ? Math.round((sectionsDone / sectionsTotal) * 100) : 0,
    rows,
    next,
    resume: resume ?? next,
  };
}

export interface HSearchHit {
  moduleId: string;
  moduleTitle: string;
  section: NSectionKey;
  label: string;
  id: string;
  title: string;
  snippet: string;
  score: number;
}

/**
 * Search every published record, not just titles: a learner searching "label" finds the forms
 * lesson, and one searching "sandbox" finds the embed warning. Title matches outrank body matches,
 * and an exact title beats a partial one.
 */
export function hSearch(modules: NModule[], rawQuery: string, limit = 20): HSearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return [];
  const hits: HSearchHit[] = [];
  for (const m of modules) {
    for (const s of N_SECTIONS) {
      for (const e of (m.sections[s.key] ?? []) as NEntry[]) {
        const title = String(e.title ?? e.q ?? '').trim();
        const body = [e.body, e.statement, e.error, e.task, e.answer, e.code]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .join(' ')
          .toLowerCase();
        const lowerTitle = title.toLowerCase();
        let score = 0;
        if (lowerTitle === query) score = 100;
        else if (lowerTitle.startsWith(query)) score = 60;
        else if (lowerTitle.includes(query)) score = 40;
        else if (body.includes(query)) score = 10;
        if (!score) continue;
        const at = body.indexOf(query);
        const raw = body || title;
        const snippet = at >= 0
          ? body.slice(Math.max(0, at - 40), Math.min(body.length, at + 80)).trim()
          : raw.slice(0, 120).trim();
        hits.push({ moduleId: m.id, moduleTitle: m.title, section: s.key, label: s.label, id: e.id, title, snippet, score });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
