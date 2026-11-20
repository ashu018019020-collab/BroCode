-- Dedicated ML per-course progress column + direct ML sync.
--
-- WHY THIS IS A SEPARATE COLUMN. `progress_snapshots.per_course` already exists, but it is the
-- NumPy payload: `checked_per_course` accepts only `nmod:` / `nans:` / `ntick:` plus its exact
-- NumPy keys, and `save_my_numpy_progress` REPLACES that whole column. Reusing it for ML would mix
-- the two key families and let a NumPy save erase ML records (or vice versa). The ML course needs
-- its own slice, so this migration adds `ml_per_course` beside it; neither course writer touches
-- the other column.
--
-- SAFETY. The column is additive with a `'{}'` default, so existing rows and older clients keep
-- working. This migration does NOT change RLS, table grants, the SELECT policy, or the generic
-- `save_my_progress` function. The new RPC is SECURITY DEFINER, derives the caller from
-- `auth.uid()` (never an argument), writes only the caller's `ml_per_course`, and is granted to
-- `authenticated` only. The payload accepts `mmod:` records only, bounded to 600 records, 20 KB per
-- draft and 64 KB total; the same limits are enforced by the client and `server/app.mjs`.
--
-- Apply with `npm run db:deploy`. Never `migrate reset` or `db push` against production.

ALTER TABLE public.progress_snapshots
  ADD COLUMN IF NOT EXISTS ml_per_course jsonb NOT NULL DEFAULT '{}'::jsonb;

/**
 * The ML payload validator. It is deliberately separate from `checked_per_course`: a NumPy key,
 * a NumPy exact key, or an unknown key is rejected, so the two course families cannot collide.
 */
CREATE OR REPLACE FUNCTION public.checked_ml_per_course(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  payload jsonb := COALESCE(input, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'ml_per_course must be a JSON object.';
  END IF;
  IF octet_length(payload::text) > 65536 THEN
    RAISE EXCEPTION 'ml_per_course exceeds the payload limit.';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(payload)) > 600 THEN
    RAISE EXCEPTION 'ml_per_course holds too many records.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(payload) AS entry(key, value)
    WHERE NOT entry.key LIKE 'mmod:%'
      OR jsonb_typeof(entry.value) <> 'object'
      OR (
        entry.value ? 'answer'
        AND (
          jsonb_typeof(entry.value -> 'answer') <> 'string'
          OR char_length(entry.value ->> 'answer') > 20000
        )
      )
  ) THEN
    RAISE EXCEPTION 'ml_per_course must hold only bounded mmod records.';
  END IF;
  RETURN payload;
END;
$function$;

REVOKE ALL ON FUNCTION public.checked_ml_per_course(jsonb) FROM PUBLIC, anon;

/**
 * Course-only ML write. It touches only `ml_per_course`, so it can never overwrite XP, the resume
 * position, or the NumPy `per_course` column. A missing snapshot row is created with database
 * defaults; the profile bootstrap deliberately writes no role or status.
 */
CREATE OR REPLACE FUNCTION public.save_my_ml_progress(
  per_course jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  me uuid := auth.uid();
  course_payload jsonb;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Sign in to save ML progress.';
  END IF;

  course_payload := public.checked_ml_per_course(per_course);

  INSERT INTO public.profiles (id) VALUES (me) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.progress_snapshots (user_id, ml_per_course, updated_at)
  VALUES (me, course_payload, now())
  ON CONFLICT (user_id) DO UPDATE SET
    ml_per_course = EXCLUDED.ml_per_course,
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.save_my_ml_progress(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_ml_progress(jsonb) TO authenticated;
