import { useEffect, useState } from 'react';
import { browserSupabaseConfig, getSupabaseClient } from '../auth/client';
import {
  mergePlacements, type CoursePlacement, type PlacementOverride,
} from '../learning/course-levels';

/**
 * The owner's course-order override, read from Supabase.
 *
 * Read path: every visitor selects the four public columns (RLS allows SELECT to anyone). Write
 * path: the table's policy only accepts a JWT whose app_metadata says `brocode_role = admin`, so the
 * browser cannot promote itself. Nothing here is required to render the Courses page: no rows, no
 * config, no network or a missing table all fall back to the code-authored order in
 * `core/learning/course-levels.ts`, which is why the app still works offline.
 */
interface PlacementRow {
  slug: string;
  level: string;
  sort_order: number;
  optional: boolean;
}

const selectRows = () => getSupabaseClient()
  .from('course_placement')
  .select('slug,level,sort_order,optional');

/** `null` means "could not read" (unconfigured, offline or the migration is not deployed yet). */
export async function loadPlacementOverrides(): Promise<PlacementOverride[] | null> {
  if (!browserSupabaseConfig()) return null;
  try {
    const { data, error } = await selectRows();
    if (error) return null;
    return ((data ?? []) as PlacementRow[]).map((row) => ({
      slug: String(row.slug),
      level: row.level as PlacementOverride['level'],
      order: Number(row.sort_order),
      optional: Boolean(row.optional),
    }));
  } catch {
    return null;
  }
}

/** Returns an error message, or null on success. Only an admin JWT can pass the table's policy. */
export async function savePlacementOverrides(rows: readonly PlacementOverride[]): Promise<string | null> {
  if (!browserSupabaseConfig()) return 'The account service is not configured on this device.';
  try {
    const { error } = await getSupabaseClient()
      .from('course_placement')
      .upsert(
        rows.map((row) => ({
          slug: row.slug,
          level: row.level,
          sort_order: row.order,
          optional: Boolean(row.optional),
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'slug' },
      );
    return error ? error.message : null;
  } catch (error) {
    return error instanceof Error ? error.message : 'The order could not be saved.';
  }
}

/** Drops every override, returning the page to the code-authored journey. */
export async function clearPlacementOverrides(): Promise<string | null> {
  if (!browserSupabaseConfig()) return 'The account service is not configured on this device.';
  try {
    const { error } = await getSupabaseClient().from('course_placement').delete().neq('slug', '');
    return error ? error.message : null;
  } catch (error) {
    return error instanceof Error ? error.message : 'The overrides could not be cleared.';
  }
}

export interface CoursePlacementsState {
  placements: CoursePlacement[];
  source: 'built-in' | 'database';
  loading: boolean;
}

/** The journey to render: database overrides when they exist, the built-in order otherwise. */
export function useCoursePlacements(): CoursePlacementsState {
  const [state, setState] = useState<CoursePlacementsState>({
    placements: mergePlacements([]), source: 'built-in', loading: true,
  });
  useEffect(() => {
    let live = true;
    void loadPlacementOverrides().then((rows) => {
      if (!live) return;
      setState({
        placements: mergePlacements(rows ?? []),
        source: rows && rows.length > 0 ? 'database' : 'built-in',
        loading: false,
      });
    });
    return () => { live = false; };
  }, []);
  return state;
}
