-- Per-course progress column + direct NumPy sync.
--
-- WHY. `numpy_progress` is written by the optional account API only. On a static deployment there is
-- no `/api`, so the NumPy course's own records (`nmod:`, `nans:`, `ntick:`, `ncap`, `nlast`, `nlevel`)
-- never leave the device even though the aggregate snapshot does. This migration puts that slice on
-- the snapshot row itself, so one identity-bound write path carries both the counters and the course
-- records, and a new device can restore them without an API.
--
-- SAFETY. The column is additive with a `'{}'` default, so existing rows and older clients keep
-- working. `save_my_progress` is REPLACED (the 9-argument signature is dropped to avoid an ambiguous
-- overload) and keeps its whole contract: caller from `auth.uid()`, never an argument; counters
-- re-validated; table writes still revoked, SELECT still limited to the caller's own row. The
-- `per_course` payload is validated by `checked_per_course` against the same allowlist and limits as
-- `server/app.mjs`: 600 records, 20 KB per draft, 64 KB total, objects only.
--
-- Apply with `npm run db:deploy`. Never `migrate reset` or `db push` against production.

ALTER TABLE public.progress_snapshots
  ADD COLUMN IF NOT EXISTS per_course jsonb NOT NULL DEFAULT '{}'::jsonb;

/**
 * The NumPy payload validator, shared by both write functions.
 * Returns the payload unchanged (an empty object for NULL) or raises, so no caller can store junk.
 */
CREATE OR REPLACE FUNCTION public.checked_per_course(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  payload jsonb := COALESCE(input, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'per_course must be a JSON object.';
  END IF;
  IF octet_length(payload::text) > 65536 THEN
    RAISE EXCEPTION 'per_course exceeds the payload limit.';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(payload)) > 600 THEN
    RAISE EXCEPTION 'per_course holds too many records.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(payload) AS entry(key, value)
    WHERE NOT (
        entry.key LIKE 'nmod:%'
        OR entry.key LIKE 'nans:%'
        OR entry.key LIKE 'ntick:%'
        OR entry.key IN ('ncap', 'nlast', 'nlevel')
      )
      OR jsonb_typeof(entry.value) <> 'object'
      OR (
        entry.value ? 'answer'
        AND (
          jsonb_typeof(entry.value -> 'answer') <> 'string'
          OR char_length(entry.value ->> 'answer') > 20000
        )
      )
  ) THEN
    RAISE EXCEPTION 'per_course must hold only bounded NumPy records.';
  END IF;
  RETURN payload;
END;
$function$;

REVOKE ALL ON FUNCTION public.checked_per_course(jsonb) FROM PUBLIC, anon;

-- The old signature is replaced, not kept beside the new one: two candidates for a 9-argument call
-- would make PostgREST report "function is not unique". The new parameter has a default, so an older
-- client that sends only the counters still resolves here.
DROP FUNCTION IF EXISTS public.save_my_progress(
  integer, integer, integer, integer, integer, integer, integer, character varying, character varying
);

CREATE OR REPLACE FUNCTION public.save_my_progress(
  xp integer,
  streak_current integer,
  practiced_count integer,
  done_records integer,
  study_minutes integer,
  study_days integer,
  open_mistakes integer,
  last_section_id character varying DEFAULT NULL,
  last_stage character varying DEFAULT NULL,
  per_course jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  me uuid := auth.uid();
  is_real_stage boolean;
  course_payload jsonb;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Sign in to save progress.';
  END IF;

  IF xp IS NULL OR xp < 0 OR xp > 2147483647
     OR streak_current IS NULL OR streak_current < 0 OR streak_current > 2147483647
     OR practiced_count IS NULL OR practiced_count < 0 OR practiced_count > 2147483647
     OR done_records IS NULL OR done_records < 0 OR done_records > 2147483647
     OR study_minutes IS NULL OR study_minutes < 0 OR study_minutes > 2147483647
     OR study_days IS NULL OR study_days < 0 OR study_days > 2147483647
     OR open_mistakes IS NULL OR open_mistakes < 0 OR open_mistakes > 2147483647 THEN
    RAISE EXCEPTION 'Progress counters must be non-negative integers.';
  END IF;

  IF last_section_id IS NOT NULL AND last_section_id !~ '^[A-Za-z0-9_-]{1,32}$' THEN
    RAISE EXCEPTION 'last_section_id must be a short section identifier.';
  END IF;

  IF last_stage IS NOT NULL THEN
    SELECT last_stage IN (
      'learn', 'interview', 'coding', 'logic', 'debug',
      'solved', 'mini', 'project', 'defense', 'checkpoint'
    ) INTO is_real_stage;
    IF NOT is_real_stage THEN
      RAISE EXCEPTION 'last_stage must be a real lesson stage.';
    END IF;
  END IF;

  course_payload := public.checked_per_course(per_course);

  -- A missing profile row must never block the snapshot: create it with database defaults.
  -- `role`/`status` are deliberately NOT written here, so this path can neither mint an
  -- administrator nor re-enable a banned account.
  INSERT INTO public.profiles (id) VALUES (me) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.progress_snapshots (
    user_id, xp, streak_current, practiced_count, done_records,
    study_minutes, study_days, open_mistakes, last_section_id, last_stage, per_course, updated_at
  ) VALUES (
    me, xp, streak_current, practiced_count, done_records,
    study_minutes, study_days, open_mistakes, last_section_id, last_stage, course_payload, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    xp = EXCLUDED.xp,
    streak_current = EXCLUDED.streak_current,
    practiced_count = EXCLUDED.practiced_count,
    done_records = EXCLUDED.done_records,
    study_minutes = EXCLUDED.study_minutes,
    study_days = EXCLUDED.study_days,
    open_mistakes = EXCLUDED.open_mistakes,
    last_section_id = EXCLUDED.last_section_id,
    last_stage = EXCLUDED.last_stage,
    per_course = EXCLUDED.per_course,
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.save_my_progress(
  integer, integer, integer, integer, integer, integer, integer, character varying, character varying, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_progress(
  integer, integer, integer, integer, integer, integer, integer, character varying, character varying, jsonb
) TO authenticated;

/**
 * Course-only writes. The NumPy page saves its records after every change, but it does not own the
 * aggregate counters — sending zeros through `save_my_progress` would wipe real XP. This function
 * touches ONLY the caller's `per_course` column and creates the snapshot row with database defaults
 * when it is missing.
 */
CREATE OR REPLACE FUNCTION public.save_my_numpy_progress(
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
    RAISE EXCEPTION 'Sign in to save NumPy progress.';
  END IF;

  course_payload := public.checked_per_course(per_course);

  INSERT INTO public.profiles (id) VALUES (me) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.progress_snapshots (user_id, per_course, updated_at)
  VALUES (me, course_payload, now())
  ON CONFLICT (user_id) DO UPDATE SET
    per_course = EXCLUDED.per_course,
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.save_my_numpy_progress(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_numpy_progress(jsonb) TO authenticated;
