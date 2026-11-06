-- Owner-controlled course order
--
-- The Courses page's journey (levels + order + optional flag) is authored in code. This table is
-- the owner's override: one row per course that has been moved, read by every visitor, written only
-- by an administrator. Courses with no row keep the code-authored placement, so an empty table is a
-- no-op and the page never depends on a write having happened.
--
-- The level is a closed set; `sort_order` is the position INSIDE that level. No course content,
-- ids, progress or routes live here — only the four fields above.
--
-- Writes are gated by the SAME claim the owner dashboard uses: Supabase's `brocode_role` in
-- app_metadata, which a browser cannot set for itself.
-- Apply with `npm run db:deploy`. Never `migrate reset` or `db push` against production.

CREATE TABLE IF NOT EXISTS public.course_placement (
  slug        varchar(64) PRIMARY KEY,
  level       varchar(24) NOT NULL
              CHECK (level IN ('beginner','foundations','intermediate','advanced','professional','career')),
  sort_order  integer     NOT NULL CHECK (sort_order BETWEEN 1 AND 999),
  optional    boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

ALTER TABLE public.course_placement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "course placement is readable" ON public.course_placement;
CREATE POLICY "course placement is readable"
  ON public.course_placement FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "admins manage course placement" ON public.course_placement;
CREATE POLICY "admins manage course placement"
  ON public.course_placement FOR ALL
  USING (coalesce(auth.jwt() -> 'app_metadata' ->> 'brocode_role', '') = 'admin')
  WITH CHECK (coalesce(auth.jwt() -> 'app_metadata' ->> 'brocode_role', '') = 'admin');
