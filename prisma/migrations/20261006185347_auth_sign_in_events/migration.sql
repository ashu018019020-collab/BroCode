CREATE TABLE public.sign_in_events (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  provider varchar(16) NOT NULL CHECK (provider IN ('email', 'google', 'github', 'other')),
  signed_in_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sign_in_events_user_id_signed_in_at_idx
  ON public.sign_in_events (user_id, signed_in_at DESC);
CREATE INDEX sign_in_events_signed_in_at_idx
  ON public.sign_in_events (signed_in_at DESC);

ALTER TABLE public.sign_in_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sign_in_events FROM anon, authenticated;
