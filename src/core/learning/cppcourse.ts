/**
 * The C++ Mastery course's pure rules.
 *
 * Same ten-section architecture as NumPy and Pandas Mastery, but its own storage family. A shared key
 * would let a C++ module complete a course module with the same number, so every record is
 * `cppmod:<module>:<section>` and nothing else can count it.
 *
 * Pure on purpose: no React, no store, no fetch, so the arithmetic is driven with fixtures under
 * `node --test`.
 */
import { N_SECTIONS, type NEntry, type NModule, type NSectionKey } from './ncourse';

export const C_LAST_KEY = 'cpplast';

/** One completion record: the section of a module was worked through. */
export function cSectionKey(moduleId: string, section: NSectionKey): string {
  return `cppmod:${moduleId}:${section}`;
}

/** A written answer draft, per entry, so it survives a refresh. */
export function cWrittenKey(entryId: string): string {
  return `cppans:${entryId}`;
}

/** A module is complete when all ten sections have a record — never from a score. */
export function cIsModuleComplete(moduleId: string, attempts: Record<string, unknown>): boolean {
  return N_SECTIONS.every((s) => Boolean(attempts[cSectionKey(moduleId, s.key)]));
}

export interface CProgress {
  modulesDone: number;
  modulesTotal: number;
  pct: number;
  sectionsDone: number;
  sectionsTotal: number;
}

export function cProgress(modules: { id: string }[], attempts: Record<string, unknown>): CProgress {
  const total = modules.length * N_SECTIONS.length;
  let sectionsDone = 0;
  let modulesDone = 0;
  for (const m of modules) {
    const done = N_SECTIONS.filter((s) => Boolean(attempts[cSectionKey(m.id, s.key)])).length;
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

export interface CReportRow {
  id: string;
  no: number;
  title: string;
  done: number;
  total: number;
  pct: number;
}

export interface CReport extends CProgress {
  rows: CReportRow[];
  next: { moduleId: string; section: NSectionKey } | null;
  resume: { moduleId: string; section: NSectionKey } | null;
}

/** The first section with something left in it — what "Continue" opens. */
export function cNextSection(moduleId: string, attempts: Record<string, unknown>): NSectionKey {
  return N_SECTIONS.find((s) => !attempts[cSectionKey(moduleId, s.key)])?.key ?? 'checkpoint';
}

/** Per-module report, the next untouched place and the stored resume point. */
export function cReport(modules: NModule[], attempts: Record<string, unknown>, last?: string): CReport {
  const rows: CReportRow[] = [];
  let sectionsDone = 0;
  for (const m of modules) {
    const recorded = N_SECTIONS.filter((s) => Boolean(attempts[cSectionKey(m.id, s.key)])).length;
    sectionsDone += recorded;
    rows.push({
      id: m.id, no: m.no, title: m.title, done: recorded, total: N_SECTIONS.length,
      pct: Math.round((recorded / N_SECTIONS.length) * 100),
    });
  }
  const sectionsTotal = modules.length * N_SECTIONS.length;
  const modulesDone = rows.filter((r) => r.done === r.total).length;
  const fresh = modules.find((m) => !cIsModuleComplete(m.id, attempts));
  const next = fresh ? { moduleId: fresh.id, section: cNextSection(fresh.id, attempts) } : null;
  let resume: CReport['resume'] = null;
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

export interface CSearchHit {
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
 * Search every published record, not just titles: a learner searching "move" finds the lesson that
 * explains it, and one searching "segmentation" finds the debug item that crashes. Title matches
 * outrank body matches, and an exact title beats a partial one.
 */
export function cSearch(modules: NModule[], rawQuery: string, limit = 20): CSearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return [];
  const hits: CSearchHit[] = [];
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
