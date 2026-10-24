-- Profile completeness + RLS re-verification.
--
-- WHY THIS MIGRATION EXISTS. BroCode used to let anyone learn without an account, so a missing or
-- incomplete profile was tolerable: the browser held the learning data and the account was an
-- optional extra. Accounts are now MANDATORY, which makes the profile the row every authenticated
-- request resolves through — and it was missing three things the client and the API already want:
--
--   · `email`      — a mirror of the Supabase Auth address, for the owner dashboard and support.
--   · `avatar_url` — where a profile photo can live server-side later; the app keeps it in the
--                    browser today, so the column is nullable and unused until something writes it.
--   · `updated_at` — there was only `created_at`, so "when was this account last changed?" had no
--                    answer that did not mean "last seen".
--
-- ADDITIVE AND REVERSIBLE. Every column is nullable or defaulted, so this applies to a live table
-- with existing rows without a rewrite and without touching a single learner's data. Nothing is
-- dropped, renamed, or back-filled destructively. `DROP` statements are provided at the bottom,
-- commented out, so a rollback is a copy-paste rather than an archaeology exercise.
--
-- ORDER: run `npm run db:deploy` (prisma migrate deploy). Never `migrate reset` / `db push` against
-- a production database — see docs/SECURITY.md.

-- ---------------------------------------------------------------------------
-- 1. The three columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- 2. Keep `updated_at` honest
--
-- A column that only moves when the application remembers to set it is a column that lies. The
-- trigger is the database's own guarantee, so a manual UPDATE from psql or from a future admin tool
-- cannot leave a stale timestamp behind.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Re-assert the access rules
--
-- These were already true after 20261002120000_supabase_accounts. They are restated because a
-- later migration that recreated or altered the table could have silently dropped them, and because
-- RLS is the ONLY thing standing between a publishable key and every learner's row — the API's own
-- checks are the second line, not the first. `ENABLE` is idempotent; the REVOKEs are the important
-- half, since a grant to `anon`/`authenticated` would let the browser read or write the table
-- directly with the public key and bypass the server entirely.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sign_in_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.progress_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.sign_in_events FROM anon, authenticated;

-- Belt and braces: deny-by-default policies. With no permissive policy present, RLS already denies
-- every row to every role; these make the INTENT explicit and make an accidental future
-- `CREATE POLICY ... USING (true)` stand out as a change rather than a no-op.
DROP POLICY IF EXISTS profiles_no_client_access ON public.profiles;
CREATE POLICY profiles_no_client_access ON public.profiles
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS progress_no_client_access ON public.progress_snapshots;
CREATE POLICY progress_no_client_access ON public.progress_snapshots
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS sign_ins_no_client_access ON public.sign_in_events;
CREATE POLICY sign_ins_no_client_access ON public.sign_in_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- The service_role is the ONLY role that touches these tables, and it bypasses RLS by design. It
-- exists only on the server (`SUPABASE_SECRET_KEY`), never in the browser bundle.

-- ---------------------------------------------------------------------------
-- 4. Keep the profile-creation trigger and its backfill correct
--
-- `create_profile_for_auth_user` was created in 20261002120000 and inserts `display_name` only. It
-- is recreated here to also carry the email mirror, so an account created AFTER this migration gets
-- both from the start. `ON CONFLICT DO NOTHING` keeps it idempotent: a retry, a duplicated webhook or
-- an existing row can never raise, and a failed insert can never leave a half-created account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.create_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.create_profile_for_auth_user() FROM PUBLIC, anon, authenticated;

-- Backfill the email for accounts that already have a profile. Only NULLs are filled, so an
-- administrator's manual correction is never overwritten.
UPDATE public.profiles AS p
SET email = u.email
FROM auth.users AS u
WHERE p.id = u.id
  AND p.email IS NULL
  AND u.email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ROLLBACK (deliberately commented — uncomment to revert this migration exactly)
-- ---------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
-- DROP FUNCTION IF EXISTS private.touch_updated_at();
-- DROP POLICY IF EXISTS profiles_no_client_access ON public.profiles;
-- DROP POLICY IF EXISTS progress_no_client_access ON public.progress_snapshots;
-- DROP POLICY IF EXISTS sign_ins_no_client_access ON public.sign_in_events;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_url;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;
