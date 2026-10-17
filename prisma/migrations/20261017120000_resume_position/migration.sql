-- Resume position
--
-- "Continue Learning" must open the lesson the account last read, including on a device that has
-- never opened one. The browser already stores the full progress; this migration adds only the two
-- fields the account service was missing to answer "where was this learner?", so the answer can
-- travel between devices.
--
-- ADDITIVE, NULLABLE, NO REWRITE. Existing rows keep NULL and the app falls back to its local
-- history (then to the first lesson), exactly as before. Nothing is dropped, renamed or back-filled.
-- The values are a section id and a stage name, validated by the API before they are written; they
-- are not free text and cannot become a route on their own.
--
-- Apply with `npm run db:deploy`. Never `migrate reset` or `db push` against production.

ALTER TABLE public.progress_snapshots
  ADD COLUMN IF NOT EXISTS last_section_id varchar(32);

ALTER TABLE public.progress_snapshots
  ADD COLUMN IF NOT EXISTS last_stage varchar(16);
