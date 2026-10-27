# Security

The verified security model of BroCode's optional account service. **No secret values appear in this
document.** Everything here was read from the source and confirmed by the existing tests; nothing is
aspirational.

## The one boundary that matters: `VITE_` prefix

| Prefix | Where it goes | What may be there |
|---|---|---|
| `VITE_*` | Inlined into the JavaScript **the browser downloads**. Anyone can read it. | Only the Supabase **publishable** key. |
| Everything else | Server only (`npm run dev:api`). | Secret key, `DATABASE_URL`, `DIRECT_URL`, `WEB_ORIGIN`, `BOOTSTRAP_ADMIN_EMAIL`. |

The prefix is the whole difference between a secret and a published string. Verified:

- `src/core/auth/client.ts` reads exactly `import.meta.env.VITE_SUPABASE_URL` and
  `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` — nothing else.
- No `process.env` access anywhere under `src/`.
- A scan of the built `dist/` for `sb_secret`, `SERVICE_ROLE`, `SUPABASE_SECRET_KEY` and
  `postgresql://` returns nothing.
- `dist/.env` does not exist.
- `.env` is gitignored and **is not tracked** by git (`.gitignore` covers `.env` and `.env.*`, with
  `!.env.example` as the single exception).

**Operational warning:** `.env.example` is a template and must only ever contain placeholders. Review
any diff to it before committing, because a real value pasted there and committed cannot be
un-committed in practice.

## Authorization

| Rule | Where it is enforced |
|---|---|
| Role is read from the **database on every request**, never from the token or the client | `server/app.mjs` `requireAdmin()` → `store.getProfile()` |
| A disabled account is rejected | `getUser()` returns `null` when `profile.status !== 'active'` |
| A client cannot forge its own role | Supabase-Auth path reads `app_metadata.brocode_role`, and `app_metadata` is admin-writable only — it lives inside a Supabase-signed token |
| Progress may not be spoofed | `validateProgress()` rejects anything that is not a non-negative safe integer ≤ 2 147 483 647, and the field list is server-owned |
| Administrators cannot be disabled through the API | `PATCH /api/admin/users/:id/status` rejects `target.role === 'admin'` |
| A caller cannot act as another user | The user id comes only from the verified bearer token; no endpoint accepts a user id from the body |

The client never supplies its own role, user id, score or permission as proof of anything.

## Request hardening (`server/app.mjs`)

- **Origin:** mutated endpoints (`presence`, `sign-in-event`, `progress/snapshot`, admin `PATCH`) call
  `ensureSameOrigin()`, which requires `Origin === WEB_ORIGIN`. Read endpoints set
  `Access-Control-Allow-Origin` only for the allowed origin and add `Vary: Origin`.
- **Body size:** capped at 16 KB; exceeding it is a 413, not a truncation.
- **Content type:** must be `application/json`, else 415.
- **Headers on every response:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`,
  a `Permissions-Policy` that denies camera/mic/geolocation/payment/USB, and a
  `Content-Security-Policy` of `default-src 'none'`.
- **TLS:** `ENFORCE_HTTPS` (on unless explicitly `off`) sends HSTS and 308-redirects to an HTTPS
  location whose host is validated against an anchored pattern.
- **Errors:** `HttpError` carries a safe, authored message. Anything else becomes a generic 500 and is
  logged as `error.code`/`error.name` only — never a stack trace, a query, or a credential.

## Database

`prisma/migrations/20261002120000_supabase_accounts/migration.sql` was reviewed line by line:

- `profiles` / `progress_snapshots` have `ENABLE ROW LEVEL SECURITY` and
  `REVOKE ALL ON TABLE ... FROM anon, authenticated`. Neither table is reachable with a publishable
  key; every read and write goes through the Node API using the secret key.
- The `private` schema is revoked from `PUBLIC, anon, authenticated`.
- The profile-creation trigger is `SECURITY DEFINER` with `SET search_path = ''` (so a caller cannot
  shadow a function name), the function is revoked from `PUBLIC`, and existing `auth.users` are
  backfilled with `ON CONFLICT (id) DO NOTHING`.
- `ALTER TABLE`/`CREATE` only — the migration is additive. `CHECK` constraints back every numeric
  progress column (`xp >= 0`, …) and both enums (`role`, `status`).

`server/db-config.mjs` refuses a `DATABASE_URL` that still contains a dashboard placeholder, so the
process fails loudly at boot instead of returning 500s to learners later.

## Migration safety

- Use `npm run db:validate` then `npm run db:deploy` (`prisma migrate deploy`) in production.
  **Never** `migrate reset`, `migrate dev` against production, or `db push`.
- Migrations are additive and reversible in practice: add nullable columns or new tables, backfill,
  then constrain. Do not drop or rewrite a column that carries `profiles` / `progress_snapshots` data.
- Learner progress lives in two places by design: the **browser** (per-account localStorage namespace,
  the source of truth for the learning app) and a **summary snapshot** in Postgres
  (7 integers + a sign-in log). Never treat the snapshot as authoritative over the learner's own
  device.
- No secret (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SECRET_KEY`) may be exposed to the browser, put
  in `VITE_*`, logged, or returned in an error body.

## What is intentionally *not* hardened

Stated so it is a decision, not an oversight:

- **No rate limiting** on `/api/auth/presence` or `/api/auth/sign-in-event`. They are authenticated
  and cheap; a real deployment should add a limiter at the proxy or with a small in-process token
  bucket.
- **`/api/health` is unauthenticated** and reports `{api, database, store}`. It reveals only which
  backend answered, which an operator needs; it exposes no user data.
- **CSRF** is handled by same-origin enforcement plus `Authorization: Bearer` rather than a token,
  which is not automatically attached by a browser. No cookie-based session exists to forge.
- The admin panel is server-authorized but the **UI is not the control**: hiding a button is not a
  security measure, and `requireAdmin` is the actual gate.

## Stored-data boundary: the imported progress file

`importProgress` accepts a JSON file the learner supplies and merges it into application state. Almost
every field in it is a number or a key, but **one field reaches markup**: `profile.avatar` is put into
`<img src>`.

**Confirmed defect (fixed).** The merge was `{ ...defaultState(), ...parsed }` with no check on the
avatar, so the file's value went into the `src` untouched. It never passed the 128×128 canvas that the
photo picker uses, because that canvas is a *caller* guarantee, not a validation step. Three
consequences, in order of severity:

1. **No size cap.** `setState` serialises the whole `AppState` to localStorage on every write, so an
   oversized avatar does not just bloat one field — it slows every subsequent write and can push the
   state past the quota, at which point **progress silently stops saving**. That is a data-loss path,
   not a cosmetic one.
2. A non-image scheme (`javascript:`, `data:text/html,…`) was placed verbatim into an `<img src>`.
   Browsers do not execute script from `<img>`, so this was **not** a live XSS — but it is one
   `<img>`→`<iframe>` refactor away from being one, and it is never a legitimate value.
3. An **SVG** data URL is a document, not a bitmap; `<img>` is the only thing keeping its script inert.

**Fix:** `src/core/platform/avatar.ts` owns the rule (allow-list `png|jpeg|jpg|webp|gif` base64 data
URLs, 64 KB cap ≈ 8× what the app's own writer produces) and it is applied at the boundary
(`importProgress`) **and** in `setAvatar`, so neither trusts its caller. A refused photo is dropped
with a named reason rather than rejecting an otherwise valid progress file.

`scripts/tests/theme.test.mjs` pins both halves: the accept/reject cases, and that the import boundary
actually calls the check — a missing call is the vulnerability.

## The auth boundary changed: an account is now required

This section was written when BroCode was guest-first. It is restated because the change moves work
onto the layers that actually enforce anything:

- **Every protected route** is wrapped in `RequireAuth` (`src/features/auth/RequireAuth.tsx`). That is
  flow and UX, **not** security — it decides what renders.
- **The server** verifies the Supabase access token on every protected request and reads the
  database-backed role. This is the real gate.
- **The database** denies every row to `anon` and `authenticated` through RLS. This is what makes the
  publishable key safe to ship in the browser bundle.

The old guest model meant learning data lived only in the browser, so an unauthenticated visitor
touched no server data. Now every learner has a server-side profile, so the server and RLS carry
weight they did not before. `prisma/migrations/20261007120000_profile_completeness_rls/migration.sql`
re-asserts RLS, `REVOKE ALL` on all three tables, and adds deny-by-default policies (`USING (false)`)
so an accidental future permissive policy stands out as a change rather than a no-op.

**A missing profile no longer locks anyone out, and does not weaken authorization.** `getProfile`
upserts on read (idempotent, `update: {}`), using only the id from the verified token. It does not
write `role` or `status`, so it cannot mint an administrator or un-ban an account, and the caller still
rejects a non-active profile.

## Dependency advisories (measured, not fixed — with reasons)

`npm audit --omit=dev` reports **8 advisories (4 moderate, 4 high)**. None is currently exploitable in
this app, and every fix is a **breaking major upgrade**, so they are recorded rather than forced:

| Package | Advisory | Why it is not exploitable here | Fix |
|---|---|---|---|
| `pdfjs-dist` 3.11.174 | Arbitrary JS execution on opening a **malicious PDF** (high) | `PDFReader.tsx` opens only the two PDFs bundled in `public/pdf/`. There is **no file upload and no user-supplied URL** — the path is built from `import.meta.env.BASE_URL` and a constant. Exposure requires an attacker who can already replace the app's own assets. | 6.4.299 (major) |
| `monaco-editor` (via `dompurify`) | DOMPurify sanitizer bypass (high) | Monaco renders its own editor content; the app never feeds it HTML from outside. Rich text is never rendered — there is no `dangerouslySetInnerHTML` anywhere in `src/`. | 0.57.0 (major) |
| `react-router` / `react-router-dom` 6.x | Open redirect via `useNavigate`; SSR hydration constructor injection (moderate) | The app uses `HashRouter` and **every** navigation target comes from its own registries (`NAV`, `EXTRA_PATHS`, authored data) — no user input reaches `navigate()` or `to=`. There is no SSR, so the hydration advisory cannot apply. | 7.x (major) |

**Recommended action:** treat these as a scheduled, tested upgrade batch, not a hotfix. `pdfjs-dist` is
the one to do first if a future feature ever accepts an uploaded PDF — that would turn the first row
from "not reachable" into "reachable", and the version bump is the mitigation.

## Test coverage for these claims

`scripts/tests/auth.test.mjs`, `auth-store.test.mjs`, `auth-messages.test.mjs`, `auth-progress.test.mjs`,
`oauth.test.mjs`, `realtime.test.mjs` and `db-setup.test.mjs` exercise the server directly (origin
refusal, role checks, input validation, store switching) and pass. `scripts/tests/theme.test.mjs`
covers the avatar boundary described above.
