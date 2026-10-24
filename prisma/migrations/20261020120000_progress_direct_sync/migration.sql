-- Direct progress sync for deployments without the optional account API.
--
-- WHY. The app can be served as pure static files (no `server/index.mjs`). In that setup the ONLY
-- writer of learner progress used to be the Node API, so on a static host nothing ever reached the
-- database — the statusbar said "not synced" forever and the owner dashboard showed no activity.
-- This migration adds a narrow, identity-bound write path so the browser can store the same
-- aggregate snapshot directly in Supabase, which is the single source of truth for every deployment.
--
-- HOW IT STAYS SAFE. The function is SECURITY DEFINER and derives the caller from `auth.uid()` —
-- the signed JWT — never from an argument, so a caller can only ever write the row belonging to
-- their own account. `authenticated` gets NO table grants for INSERT/UPDATE on the snapshots: this
-- function is the only write path, and it re-validates every value the same way `server/app.mjs`
-- does (non-negative integer counters, a short section id, a real lesson stage). Table-level RLS
-- stays deny-by-default; the added SELECT policy exposes only the caller's own row, which is what
-- lets a signed-in learner resume a lesson on a NEW device without the API server.
--
-- ADDITIVE. One function, one grant, one policy. Nothing is dropped, no existing row is rewritten.
-- Apply with `npm run db:deploy`. Never `migrate reset` or `db push` against production.

CREATE OR REPLACE FUNCTION public.save_my_progress(
  xp integer,
  streak_current integer,
  practiced_count integer,
  done_records integer,
  study_minutes integer,
  study_days integer,
  open_mistakes integer,
  last_section_id character varying DEFAULT NULL,
  last_stage character varying DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  me uuid := auth.uid();
  is_real_stage boolean;
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

  -- A missing profile row must never block the snapshot: create it with database defaults.
  -- `role`/`status` are deliberately NOT written here, so this path can neither mint an
  -- administrator nor re-enable a banned account.
  INSERT INTO public.profiles (id) VALUES (me) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.progress_snapshots (
    user_id, xp, streak_current, practiced_count, done_records,
    study_minutes, study_days, open_mistakes, last_section_id, last_stage, updated_at
  ) VALUES (
    me, xp, streak_current, practiced_count, done_records,
    study_minutes, study_days, open_mistakes, last_section_id, last_stage, now()
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
    updated_at = now();
END;
$function$;

-- EXECUTE defaults to PUBLIC on a fresh function; the write path is for signed-in learners only.
REVOKE ALL ON FUNCTION public.save_my_progress(
  integer, integer, integer, integer, integer, integer, integer, character varying, character varying
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_progress(
  integer, integer, integer, integer, integer, integer, integer, character varying, character varying
) TO authenticated;

-- Read path: a learner may read ONLY their own snapshot row (for cross-device resume). INSERT,
-- UPDATE and DELETE on the table stay fully revoked for clients — writes go through the function.
GRANT SELECT ON TABLE public.progress_snapshots TO authenticated;

DROP POLICY IF EXISTS progress_own_row_read ON public.progress_snapshots;
CREATE POLICY progress_own_row_read ON public.progress_snapshots
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
