-- Per-course progress for NumPy Mastery.
--
-- The aggregate `progress_snapshots` row answers "how much has this account done"; it cannot answer
-- "which of the 200 NumPy sections were recorded, and what was written in the drafts". Those records
-- live in the learner's own attempts map under `nmod:` / `nans:` / `ntick:` plus `ncap`, `nlast` and
-- `nlevel`, and this table stores that allowlisted slice as JSON text so it follows the account.
--
-- Deliberately NOT a column on `progress_snapshots`: an older client writes counters with
-- `save_my_progress`, and adding a column to that row would couple two independent write paths.
-- The payload is validated in `server/app.mjs` (allowlist, 20 KB per draft, 64 KB total) before it is
-- stored; this table only ever holds the caller's own row, resolved from the JWT on the server.
--
-- Apply with `npm run db:deploy`. Never `migrate reset` or `db push` against production.

CREATE TABLE IF NOT EXISTS public.numpy_progress (
  user_id    uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  payload    text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
