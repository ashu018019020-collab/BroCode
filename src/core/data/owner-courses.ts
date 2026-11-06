import { useCallback, useEffect, useState } from 'react';
import { browserSupabaseConfig, getSupabaseClient } from '../auth/client';
import type { OwnerCourseDraft, OwnerCourseRow } from '../learning/owner-courses';

/**
 * The owner's own course cards, read from and written to Supabase.
 *
 * Read path: every visitor selects the public columns (RLS allows SELECT to anyone), so a custom
 * card renders for a signed-out visitor exactly like a catalog course. Write path: the table's
 * policy only accepts a JWT whose app_metadata carries `brocode_role = admin`, which a browser
 * cannot grant itself — the dashboard is an interface, the database is the gate.
 *
 * Nothing here is required to render `/courses`: an unconfigured project, an offline device or a
 * migration that has not been deployed all resolve to `null`, and the page keeps the built-in
 * journey. That is the same contract `course-placement.ts` follows.
 */
interface OwnerCourseDbRow {
  slug: string;
  name: string;
  summary: string | null;
  href: string;
  logo: string;
  tone: string;
  level: string;
  sort_order: number;
  optional: boolean;
  hidden: boolean;
  deleted_at: string | null;
}

const COLUMNS = 'slug,name,summary,href,logo,tone,level,sort_order,optional,hidden,deleted_at';

const toRow = (row: OwnerCourseDbRow): OwnerCourseRow => ({
  slug: String(row.slug),
  name: String(row.name ?? ''),
  summary: row.summary ?? '',
  href: String(row.href ?? ''),
  logo: String(row.logo ?? ''),
  tone: String(row.tone ?? ''),
  level: String(row.level ?? ''),
  order: Number(row.sort_order),
  optional: Boolean(row.optional),
  hidden: Boolean(row.hidden),
  deletedAt: row.deleted_at ?? null,
});

/** `null` means "could not read" — unconfigured, offline or the migration is not deployed yet. */
export async function loadOwnerCourses(): Promise<OwnerCourseRow[] | null> {
  if (!browserSupabaseConfig()) return null;
  try {
    const { data, error } = await getSupabaseClient()
      .from('owner_course')
      .select(COLUMNS)
      .order('level', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) return null;
    return ((data ?? []) as OwnerCourseDbRow[]).map(toRow);
  } catch {
    return null;
  }
}

const stamp = () => new Date().toISOString();

/** Create one card. Returns an error message, or null on success. */
export async function createOwnerCourse(draft: OwnerCourseDraft): Promise<string | null> {
  if (!browserSupabaseConfig()) return 'The account service is not configured on this device.';
  try {
    const { error } = await getSupabaseClient().from('owner_course').insert({
      slug: draft.slug.trim(),
      name: draft.name.trim(),
      summary: (draft.summary ?? '').trim(),
      href: draft.href.trim(),
      logo: draft.logo,
      tone: draft.tone,
      level: draft.level,
      sort_order: Math.round(draft.order),
      updated_at: stamp(),
    });
    if (error?.code === '23505') return 'A course with that slug already exists — pick another one.';
    return error ? error.message : null;
  } catch (error) {
    return error instanceof Error ? error.message : 'The course could not be created.';
  }
}

/** Change one card. Only the fields named in `patch` are written. */
export async function updateOwnerCourse(
  slug: string,
  patch: Partial<Pick<OwnerCourseRow, 'name' | 'summary' | 'href' | 'logo' | 'tone' | 'level' | 'optional' | 'hidden'>> & { order?: number },
): Promise<string | null> {
  if (!browserSupabaseConfig()) return 'The account service is not configured on this device.';
  const payload: Record<string, unknown> = { updated_at: stamp() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.summary !== undefined) payload.summary = patch.summary.trim();
  if (patch.href !== undefined) payload.href = patch.href.trim();
  if (patch.logo !== undefined) payload.logo = patch.logo;
  if (patch.tone !== undefined) payload.tone = patch.tone;
  if (patch.level !== undefined) payload.level = patch.level;
  if (patch.optional !== undefined) payload.optional = patch.optional;
  if (patch.hidden !== undefined) payload.hidden = patch.hidden;
  if (patch.order !== undefined) payload.sort_order = Math.round(patch.order);
  try {
    const { error } = await getSupabaseClient().from('owner_course').update(payload).eq('slug', slug);
    return error ? error.message : null;
  } catch (error) {
    return error instanceof Error ? error.message : 'The course could not be updated.';
  }
}

/**
 * Stand a custom card down WITHOUT deleting the row.
 *
 * `deleted_at` is the soft delete: the card leaves the journey, the row stays for Restore. Kept
 * separate from `deleteOwnerCourse` because a delete is irreversible from the dashboard, and an
 * owner tapping the wrong row should be able to undo it.
 */
export async function archiveOwnerCourse(slug: string): Promise<string | null> {
  if (!browserSupabaseConfig()) return 'The account service is not configured on this device.';
  try {
    const { error } = await getSupabaseClient()
      .from('owner_course')
      .update({ deleted_at: stamp(), updated_at: stamp() })
      .eq('slug', slug);
    return error ? error.message : null;
  } catch (error) {
    return error instanceof Error ? error.message : 'The course could not be archived.';
  }
}

/** Bring an archived custom card back, exactly where it was. */
export async function restoreOwnerCourse(slug: string): Promise<string | null> {
  if (!browserSupabaseConfig()) return 'The account service is not configured on this device.';
  try {
    const { error } = await getSupabaseClient()
      .from('owner_course')
      .update({ deleted_at: null, updated_at: stamp() })
      .eq('slug', slug);
    return error ? error.message : null;
  } catch (error) {
    return error instanceof Error ? error.message : 'The course could not be restored.';
  }
}

/**
 * Delete a custom card for good.
 *
 * Safe ONLY for owner cards: they own no generated content and no learner record is keyed by them,
 * so removing the row cannot orphan progress. Built-in courses are a different thing entirely and
 * are never deleted here — hide/restore is their equivalent (`course_placement.hidden`).
 */
export async function deleteOwnerCourse(slug: string): Promise<string | null> {
  if (!browserSupabaseConfig()) return 'The account service is not configured on this device.';
  try {
    const { error } = await getSupabaseClient().from('owner_course').delete().eq('slug', slug);
    return error ? error.message : null;
  } catch (error) {
    return error instanceof Error ? error.message : 'The course could not be deleted.';
  }
}

/** The rows the dashboard loads once; `rows === null` means the table is unreachable. */
export function useOwnerCourses() {
  const [rows, setRows] = useState<OwnerCourseRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setRows(await loadOwnerCourses());
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { rows, loading, reload };
}
