-- Owner-created course cards
--
-- The catalog courses are authored content (`content/**` → generators) and every one of them owns a
-- page, steps, question ids and stored progress records. A dashboard therefore cannot delete one —
-- `course_placement.hidden` is the safe equivalent and already exists.
--
-- This table is the other half: cards the OWNER creates. A custom card owns no content of its own —
-- it is a name, a bundled mark, a level and the internal page it opens — so deleting a row can never
-- orphan a learner's progress or break an authored link. `deleted_at` is the soft delete (Archive)
-- so a mistaken removal is restorable; a real DELETE is allowed only here because nothing references
-- these slugs.
--
-- Writes are gated by the SAME claim the owner dashboard uses: Supabase's `brocode_role` in
-- app_metadata, which a browser cannot set for itself. Reads are public, because the Courses page is
-- rendered for every visitor.
-- Apply with `npm run db:deploy`. Never `migrate reset` or `db push` against production.

CREATE TABLE IF NOT EXISTS public.owner_course (
  slug        varchar(48) PRIMARY KEY
              CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$'),
  name        varchar(80)  NOT NULL,
  summary     varchar(240) NOT NULL DEFAULT '',
  -- An INTERNAL app path only. A protocol-relative "//host" or an absolute URL would turn an owner
  -- typo into an open redirect, so the database refuses both as well as the form.
  href        varchar(200) NOT NULL DEFAULT '/courses'
              CHECK (href LIKE '/%' AND href NOT LIKE '//%' AND href NOT LIKE '% %'),
  logo        varchar(24)  NOT NULL DEFAULT 'brain',
  tone        varchar(16)  NOT NULL DEFAULT 'cyan',
  level       varchar(24)  NOT NULL
              CHECK (level IN ('beginner','foundations','intermediate','advanced','professional','career')),
  sort_order  integer      NOT NULL DEFAULT 1 CHECK (sort_order BETWEEN 1 AND 999),
  optional    boolean      NOT NULL DEFAULT false,
  hidden      boolean      NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_course ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner courses are readable" ON public.owner_course;
CREATE POLICY "owner courses are readable"
  ON public.owner_course FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "admins manage owner courses" ON public.owner_course;
CREATE POLICY "admins manage owner courses"
  ON public.owner_course FOR ALL
  USING (coalesce(auth.jwt() -> 'app_metadata' ->> 'brocode_role', '') = 'admin')
  WITH CHECK (coalesce(auth.jwt() -> 'app_metadata' ->> 'brocode_role', '') = 'admin');
