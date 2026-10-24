# BroCode — Final Production Readiness Plan

Implementation-ready plan for the BroCode learning platform (D:\project\BroCode).
This is PLAN MODE: no source edits or mutating commands are made here. An implementation-capable agent should execute the ordered tasks below and record actual results.

## Grounding (from inspection)

- Stack: Vite + React 18 + React Router (HashRouter), @supabase/supabase-js 2.75.0, Prisma 6.19.3, @prisma/client. Scripts in `package.json`; tests under `scripts/tests/` run via `node --test`.
- Gate (AGENTS.md): `npm run typecheck` + `npm test` (484 tests) + `npm run build`. No CI/linter/formatter. `build` prints a pre-existing Monaco chunk warning.
- Auth is ALREADY centralized and secure per AGENTS.md + source inspection:
  - No guest mode / no demo user / no anonymous sign-in.
  - Exactly 4 public paths: `/`, `/start`, `/login`, `/reset-password`. Every other route is wrapped in `<Protect>` (src/app/App.tsx:774-832).
  - `RequireAuth` renders a skeleton while `loading` (never redirects during session restore) — src/features/auth/RequireAuth.tsx.
  - Destination travels in router state, never `?next=` — LoginPage.tsx.
  - `defaultState()` seeds `profile.name: ''` (empty) — no personal-data prefill (src/core/storage/store.ts:26).
  - Onboarding name falls back to the verified account's `user?.name`, never seed data (src/features/dashboard/Onboarding.tsx:27).
  - i18n: `en` + Roman-script `hi` (Hinglish), packs at parity, `npm run i18n:check` enforces (src/app/i18n/locales.ts).
  - Admin: role stored in Supabase `app_metadata.brocode_role`, verified server-side on every request — never from client metadata (server/app.mjs:195-201; AdminUsersPage.tsx:178).
  - Logout clears `setStorageAccount(null)`, `setUser(null)`, `setProgressSync(idle)` (AuthProvider.tsx:276-281).
- `.env` exists locally (gitignored, NOT committed) with real Supabase creds including a `sb_secret_...` service-role key and `VITE_*` browser-safe pair. `DATABASE_URL` contains a literal `percent-encoded-password` → the Postgres pooler is almost certainly NOT connected; `server/db-config.mjs` falls back to the Supabase-Auth store (sign-in works, progress history not server-stored). DO NOT print secret values anywhere.
- Public generation contract: `content/` is source of truth; `public/generated/*` is generator output, never hand-edited. `courses:write` / `ai:index:write` must run LAST (docs/CONTENT-PIPELINE.md).

## Phase 1 — Establish the baseline (run the gate, record outcomes)

These must be executed by the implementation agent; they were NOT run in this session because bash is restricted.

1. `tsc --noEmit` (typecheck, strict). Record: passed / failed + first 5 errors.
2. `npm test` (`node --test "scripts/tests/*.test.{cjs,mjs}"`, 484 tests). Record: pass count, fail count, and the NAME of each failing test file.
3. `npm run build` (vite). Record: pass / fail; note the Monaco >1500 kB chunk warning is pre-existing and not a failure.
4. `npm run db:check` (read-only, separates DB fault classes). Record: which of DATABASE_URL/DIRECT_URL/SUPABASE_DATABASE_URL is reachable, or "no database variables set / auth-only fallback".

If any of 1-3 fails, stop and fix before Phase 2 (smallest reliable fix + regression test + rerun).

## Phase 2 — Authentication & security verification

5. Guest-access denial: confirm no `Protect`-less route exposes learning content. Already verified by reading App.tsx — all 40+ protected routes wrapped; only `/`, `/start`, `/login`, `/reset-password` public. `auth-gate.test.mjs` must pass.
6. Signup/login/password-reset honesty: an error must never be treated as success (authErrorCopy funnels all messages; invalid credentials → "Email or password is incorrect"; unconfirmed → confirmation instruction; rate limit → wait). Confirm `resetPasswordForEmail` always returns the same generic answer (account-enumeration protection) — ResetPassword.tsx:198-219.
7. Session restore: guard renders skeleton while loading, no redirect-on-refresh (RequireAuth.tsx:35-45).
8. Logout clears private in-memory state (AuthProvider logout) — verify no cached-data fallback when Supabase unreachable.
9. Admin authorization: `requireAdmin` rejects non-admin with 403; `bootstrap-admin.mjs` promotes only BOOTSTRAP_ADMIN_EMAIL (must already exist & be confirmed); ordinary learner cannot reach `/api/admin/users` (server-side token + role check).
10. User-data isolation: every server endpoint derives identity from the Supabase bearer token via `supabaseAuth.auth.getUser(token)` — never trusts a client-supplied `user_id` (app.mjs:167-187). No client-side RLS bypass possible because the browser never holds the service key.
11. Confirm `.env` is gitignored (already: .gitignore lines 7-9) and `.env.example` holds placeholders only (production-readiness test gate B covers this).
12. "The account service is unavailable right now" (SERVICE_UNAVAILABLE_COPY): confirm it is shown only for genuine service failure (missing/unreachable keys), never as a success, and the real cause is logged server-side/console only (messages.ts:19-20; client.ts:79-85).

## Phase 3 — Database & migration safety

13. Diagnose `DATABASE_URL`: the password `percent-encoded-password` is literal/unencoded. If Postgres is required:
    - Copy CURRENT connection strings from Supabase Dashboard (Project Settings → Database → URI; Session pooler for DATABASE_URL, Direct for DIRECT_URL).
    - Percent-encode any `@ : / ? #` in the password.
    - Write corrected values to local `.env` (placeholders in `.env.example` only).
    - `npm run db:deploy` (prisma migrate deploy) — migrations are additive, never drop learner data; never reset/drop/wipe production DB.
    - If DB cannot be configured: document Auth-only fallback (sign-in works; progress history not server-side) — this is a supported mode per db-config.mjs.
14. RLS/policies: verify via server authorization (every protected endpoint checks bearer token + role). No public read/write of user-owned tables. Document that user records are keyed by authenticated Supabase `id`, never email/client-supplied id.
15. Backup/rollback: document Supabase project backup (per plan) and that `db:deploy` is additive.

## Phase 4 — Content pipeline (in order, per docs/CONTENT-PIPELINE.md)

16. `npm run i18n:check` (locale pack parity + placeholders) — must pass.
17. `npm run i18n:report` (content coverage ledger) — record coverage % per source.
18. `npm run curriculum:validate` + `npm run course:audit` (dry mode) — must exit 0.
19. `npm run questions:manifest` (may not overstate coverage) + `npm run questions:duplicates`.
20. Regenerate in the documented order; `courses:write` and `ai:index:write` LAST so they publish fresh counts.
21. `npm run sitemap:write` then `npm run build` + production-readiness gate E (sitemap/robots tests). Private routes (`/admin`, `/progress`, `/notes`, `/settings`, `/onboarding`, `/login`, `/reset-password`) must NOT be in sitemap; public routes must be.
22. `npm run ai:index:write` (last). Confirm `public/generated/ai/knowledge.json.gz` matches generator byte-for-byte (ai-index.test.mjs uses Buffer.compare, NOT deepEqual).
23. Do NOT hand-edit `public/generated/*`; correct source files or generators instead.

## Phase 5 — Fix defects (smallest reliable fix)

24. For every failure surfaced in Phases 1-4: reproduce → root cause → fix → add regression test where practical → rerun affected test + broader checks.
25. Do NOT suppress compiler errors, ignore rejected promises, disable failing tests, or weaken access controls to get green.
26. No unnecessary dependency upgrades; no architectural rewrites.

## Phase 6 — UI / accessibility polish (targeted, based on findings)

27. Focus states: confirm `:focus-visible` baseline + `.path-card`, `.stage-tile`, `.lang-switch-btn`, `.bn-ai`, `.side-btn-desk` (production-readiness test gate D already asserts these).
28. `aria-invalid` accompanies every `className=…invalid…` field; form errors use `role="alert"` (gate D asserts for AuthForm/ResetPassword).
29. `prefers-reduced-motion: reduce` honoured in styles.css; decorative animation never blocks interaction.
30. Mobile: auth forms, course cards, lesson pages, quizzes, tables, admin interface must not overflow or break. No horizontal scroll.
31. Empty/error/loading states present and honest (no misleading success states).
32. Fix only real defects; preserve branding and dark/glassmorphism aesthetic.

## Phase 7 — Deployment configuration

33. Confirm hosting target (GitHub Pages origin `ashu018019020-collab.github.io/BroCode/` per index.html og:url/canonical; SPA hash routing needs no rewrite; `base: './'` in vite.config.ts).
34. Confirm no server-only code bundled into public output; API routes (server/) run on a separate persistent host (Node), NOT Vercel serverless (no long-running processes assumed).
35. Required env var NAMES (placeholders only, never values): VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, DATABASE_URL, DIRECT_URL, WEB_ORIGIN, API_PORT, BOOTSTRAP_ADMIN_EMAIL, ENFORCE_HTTPS(optional).
36. Verify `index.html` claims (title/description/og/twitter) match sitemap.test.mjs pins; `brocode-og.png` is 1200×630 (og:write if changed).
37. Document build/preview/deploy commands, rollback considerations, and post-deploy smoke tests.

## Final release gates (record actual result per gate)

- Gate A — Application: build succeeds; critical routes work; no release-blocking defects in tested flows.
- Gate B — Auth & security: no guest bypass; Supabase auth works on configured project; route/API/database/admin authorization verified; no private user-data access in tested paths; no secrets in built bundle (production-readiness gate B).
- Gate C — Data integrity: migrations/policies valid; existing data preserved; user ownership verified; generated content validates (sitemap, ai-index byte-for-byte).
- Gate D — UI & accessibility: main pages responsive; forms/nav/feedback work; focus & reduced-motion OK; fresh auth forms have no personal-data prefill.
- Gate E — Deployment: env vars documented & present (secrets not printed); hosting config matches architecture; migrations & Supabase settings documented; build/deploy commands accurate; rollback documented; smoke-test checklist ready.

## Classification (to be finalized after execution)

One of: Ready for production deployment / Conditionally ready, pending specific external setup / Not ready, with release-blocking issues remaining. Supported by real evidence from completed checks.

## Deliverable

The executing agent must produce the final report (sections A–H per the mission) with exact commands, actual outcomes, and any blocked/skipped checks clearly marked.
