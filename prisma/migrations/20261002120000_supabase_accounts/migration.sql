CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  role varchar(16) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE INDEX profiles_last_seen_at_idx ON public.profiles (last_seen_at);

CREATE TABLE public.progress_snapshots (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  streak_current integer NOT NULL DEFAULT 0 CHECK (streak_current >= 0),
  practiced_count integer NOT NULL DEFAULT 0 CHECK (practiced_count >= 0),
  done_records integer NOT NULL DEFAULT 0 CHECK (done_records >= 0),
  study_minutes integer NOT NULL DEFAULT 0 CHECK (study_minutes >= 0),
  study_days integer NOT NULL DEFAULT 0 CHECK (study_days >= 0),
  open_mistakes integer NOT NULL DEFAULT 0 CHECK (open_mistakes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.progress_snapshots FROM anon, authenticated;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.create_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
      split_part(COALESCE(NEW.email, ''), '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.create_profile_for_auth_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.create_profile_for_auth_user();

INSERT INTO public.profiles (id, display_name)
SELECT
  id,
  COALESCE(
    NULLIF(raw_user_meta_data ->> 'display_name', ''),
    split_part(COALESCE(email, ''), '@', 1)
  )
FROM auth.users
ON CONFLICT (id) DO NOTHING;
