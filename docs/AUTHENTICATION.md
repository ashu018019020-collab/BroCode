# Authentication

How an account gates BroCode: the flow, the rules, the Supabase configuration it depends on, and the
exact dashboard steps a deployment must complete. Verified against the implementation; anything that
requires dashboard access is marked as such.

## The rule

**An account is required to learn.** There is no guest mode, no anonymous sign-in, and no local-only
fallback that unlocks protected content. A visitor can read the public landing page and nothing else.

Three layers enforce it, and none of them is sufficient alone:

| Layer | Where | What it stops |
|---|---|---|
| Route guard | `src/features/auth/RequireAuth.tsx`, wrapping every protected `<Route>` in `src/app/App.tsx` | A visitor *rendering* a protected page, and losing the page they asked for |
| Server authorization | `server/app.mjs` `requireUser` / `requireAdmin`, verifying the bearer token with Supabase on every request | A caller reaching protected data by bypassing the UI entirely |
| Row Level Security | `prisma/migrations/*` | The publishable key reading or writing a row directly, bypassing the API |

Hiding a link is not protection, so the guard is convenience and flow; the server and the database are
the security boundary.

## The user journey

1. A visitor opens the app at `/`.
2. `PublicHome` sees no session and renders the **Landing** page — public, no personal data, with
   Sign in and Create account.
3. Clicking any protected feature (or a bookmarked deep link) hits `RequireAuth`.
4. While the session is still being restored, the guard renders a **skeleton** and does NOT redirect.
   This is the single most important line in the guard: redirecting here would sign out a
   legitimately signed-in learner on every page refresh.
5. Unauthenticated → redirect to `/login` with the requested path in **router state** (never a query
   string, so a crafted `?next=` cannot steer anyone).
6. Create account (name, email, password, confirm password) or sign in with email + password through
   Supabase Auth. The typed name is the display name: `register()` sends it as `display_name` in the
   sign-up metadata, and the address's local part is used only when that metadata is absent — the
   same fallback as the database trigger, so a profile is never nameless. The client checks the
   confirmation matches and that the password is at least 8 characters; Supabase enforces the real
   password rule server-side.
7. On success, redirect to the requested page — or `/admin` for an administrator, `/` otherwise.
8. If Supabase is unreachable, the session resolves to null and the learner stays on `/login` with a
   recoverable message. **Nothing unlocks.** There is no cached-demo or guest fallback.

## Session states

| State | What the app does |
|---|---|
| First visit | Landing page. No session, no data fetched. |
| Registered, signed out | Landing or `/login`. |
| Signup, confirmation required | "Check your inbox" state with a resend button. No session is granted. |
| Signup, confirmation disabled | Session established immediately; dashboard. |
| Signed in | Protected pages render. |
| Refresh | `getSession()` restores from local storage; the guard shows the skeleton, never a redirect. |
| Expired / revoked | `getUser()` returns 401 → treated as signed out → the guard redirects. |
| Sign out | `auth.signOut()`, storage namespace cleared, redirect to `/`. |
| Password reset | `/reset-password`, two halves — request by email, then set a new one. |
| Invalid recovery link | The provider's own sentence, plus a link to request a new one. |
| Supabase outage | Session resolves to null; `/login` shows `SERVICE_UNAVAILABLE_COPY`. |
| Disabled account | `getProfile().status !== 'active'` → no session at all → 401 on every endpoint. |
| Multiple tabs | `onAuthStateChange` fires in each tab; each re-applies the session. |

## Password recovery

`src/core/auth/reset.ts` owns the link parsing (pure, unit-tested). A recovery link returns to the
app root, not to a separate route, because Supabase appends its own parameters:

- **PKCE** (this app's configured flow): `?code=…` in the query, which supabase-js exchanges.
- **Implicit fallback**: `#access_token=…&type=recovery` in the fragment.

That second shape matters twice over: this app uses a **HashRouter**, so its routes live in the same
fragment. `passwordResetRequested()` therefore treats a fragment as a recovery credential only when it
looks like `k=v&k=v`, so `#/lesson/s01/learn` is never mistaken for one. Once read, the credential is
stripped from the address bar — a refresh must not replay a spent link, and a screenshot must not
capture a live one.

## Required Supabase Dashboard configuration

These are **dashboard actions, not code**, and the flow is incomplete without them. I could not verify
them: they need your project's credentials, which are deliberately not in the repository.

**Authentication → URL Configuration**

- **Site URL**: your deployed origin, e.g. `https://<user>.github.io/BroCode/`
- **Redirect URLs** — add every origin you sign in from:
  - `http://localhost:5173/**` (dev)
  - `https://<your-origin>/BroCode/**` (production)

  A redirect target that is not on this list is silently rewritten to the Site URL, which is the usual
  cause of "the recovery link goes to the dashboard" or "the confirmation link does nothing".

**Authentication → Providers → Email**

- Decide **Confirm email**. Both modes are supported:
  - **ON** — `register()` returns `{ user: null, emailConfirmationRequired: true }` and the form shows
    the inbox state with resend. No session is issued until the link is followed.
  - **OFF** — `signUp` returns a session immediately and the learner goes straight to the dashboard.
- **Minimum password length** must be ≤ 8, or `MIN_PASSWORD` in `src/core/auth/messages.ts` will
  accept a password the server rejects, and the learner sees an error the form said was fine.

**Authentication → Providers → Google / GitHub** (not offered)

Social sign-in is NOT offered: the provider buttons, the `/auth/v1/settings` probe and the OAuth
return plumbing were removed, so email is the only method. Providers enabled in the dashboard are
harmless — no UI calls them — but turning them off keeps the project's surface honest. If one is
ever re-enabled, it needs its callback URL registered here and in the provider's console.

**Authentication → Rate limits / SMTP**

The number is not a rule of thumb. Supabase's own rate-limit table (`/docs/guides/auth/rate-limits`)
says **all email-sending Auth endpoints are limited to 2 emails per hour, per PROJECT**, on the
built-in provider — and that limit is **not customizable** until you configure custom SMTP or a
send-email hook. It is shared by sign-up confirmations, resends and password recoveries, so two
sign-ups can exhaust the hour for everybody. Verified against this project on 2026-10-20:
`POST /auth/v1/signup` with the publishable key and a throwaway address answered
`429 { "error_code": "over_email_send_rate_limit", "msg": "email rate limit exceeded" }`.

That is why the form now says *"This project has used up its hourly confirmation emails. Wait about
an hour, then try again — or sign in if you already created this account."* — the window really is an
hour, and an account created before the quota ran out may already be confirmed and waiting for a
sign-in that costs no email at all. `RESEND_COOLDOWN_SECONDS` (60) in
`src/core/auth/messages.ts` holds the inbox screen's resend button for the same reason: a button
that can be pressed freely spends the whole hour in three clicks.

The operator fix is one of:

- **Authentication → Emails → SMTP Settings →** add your own SMTP host (Postmark, Resend, SES, a
  Gmail app password). The project limit becomes your provider's, not Supabase's.
- **Authentication → Rate Limits →** raise "Emails per hour" after the custom SMTP is in place.
- Only as a last resort, turn **Confirm email** off — sign-up then returns a session immediately and
the inbox state disappears. Do not do this to work around the limit on a live project; it removes
the check that an address belongs to the person typing it.

Keep a limit on `resend` whatever the sender: the resend button is the one place a learner can send
mail repeatedly.

## Testing sign-up while the mail quota is exhausted

The quota lives in the Supabase project, not in this repository, so **no code change can lift it** —
and a change that could (a bypass, a demo account, a session without a token) is exactly what
`auth-gate.test.mjs` refuses. The three routes below are dashboard actions and are listed in the
order to try them. None of them weakens the deployed app permanently.

1. **The account probably already exists — confirm it, don't re-create it.** A sign-up that was
   blocked by the quota usually left an unconfirmed user behind from an earlier attempt. Open
   **Authentication → Users**, find the address, open the row's `⋯` menu and use **Confirm email**
   (or "Confirm user"), then sign in from the **Sign in** tab with the password that was typed.
   Costs no email.
2. **Create the account with Confirm email OFF, then put it back ON.**
   - **Authentication → Sign In / Providers → Email →** switch **Confirm email** off and save.
   - Sign up in the app. `signUp` now returns a session, so the form signs the learner straight in —
     `register()` already handles both shapes (`{ user }` when a session came back, `{ user: null,
     emailConfirmationRequired: true }` when it did not) and no email is sent, so the quota is not
     touched.
   - Switch **Confirm email** back on and save. The account created in step 2 is already verified and
     keeps working, so this test account becomes your normal test login.
   - Temporary by design: while the toggle is OFF, any visitor can create an account with an address
     they do not own. Do it on a test window, not overnight.
3. **Make the limit go away properly.** Custom SMTP (**Authentication → Emails → SMTP Settings**, with
   Resend/Postmark/SES) or a **send-email hook**, then raise **Authentication → Rate Limits →
   "Emails per hour"**. Until one of those exists the project can send two emails an hour no matter
   what the form does.

`npm run doctor` reports which of these the current environment can support; `scripts/tests/auth-*`
pin the code halves (the copy, the cooldown, both `register()` branches, and the redirect target).

## Environment variables

Browser (publishable, safe to ship — RLS is what makes it safe):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

Server only (never `VITE_`-prefixed):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
SUPABASE_SECRET_KEY=your-supabase-secret-key
DATABASE_URL=postgresql://...          # optional; enables the Prisma store
DIRECT_URL=postgresql://...
WEB_ORIGIN=http://localhost:5173
API_PORT=8787
```

`VITE_SUPABASE_*` takes precedence when it is a real value. If the hosting build has neither variable
(or still has the `.env.example` placeholder), a **production** build falls back to
`src/core/auth/public-config.ts` — the project URL and the **publishable** key only. That key is
designed to be shipped to the browser and is protected by RLS; it is not a secret. The fallback exists
because a static host that was built without its environment variables used to fail every sign-in with
the generic "account service is unavailable" sentence, even though Supabase was healthy. A development
build never uses the fallback for a placeholder value, so a developer is not silently pointed at the
production project.

The **secret/service-role** key must never appear in `public-config.ts`, `.env.example`, the browser
bundle, or Git. Use it only in the optional server (`server/*.mjs`).

### Vercel

Set the browser pair in **Project → Settings → Environment Variables** for **Production** and
**Preview** (and Development for local `vercel dev`), then redeploy. Do not commit `.env`; it is
gitignored. The public fallback keeps sign-in working, but the env pair remains the recommended source
of truth so a key rotation is one dashboard change.

A build without any usable config is treated as **unconfigured**, not broken: the app logs one
actionable line to the console and sign-in is impossible — the correct degradation now that an account
is mandatory. There is no fallback that grants access.

## Database

`profiles` is keyed by the Supabase user id and is the row every authenticated request resolves
through. `email` is a **display mirror**, never a relationship key: an address can change or be
re-verified in Auth, and a schema keyed on it would detach a learner's history.

Profile creation is idempotent in two independent places, so a failure in either does not lock anyone
out:

1. A `SECURITY DEFINER` trigger on `auth.users` (`private.create_profile_for_auth_user`) with
   `ON CONFLICT (id) DO NOTHING`.
2. `server/store.mjs` `getProfile` **upserts** on read. If the trigger never ran — a migration applied
   without it, or a signup that raced it — the row is created for the token's own user id. `update: {}`
   means an existing row is never modified, and `role`/`status` are not written, so this path can
   neither clobber a profile, mint an administrator, nor un-ban an account.

## Applying the migration

```bash
npm run db:validate      # schema parses
npm run db:check         # can this machine actually REACH the database, and are the credentials right?
npm run db:deploy        # prisma migrate deploy — the ONLY production path
```

`prisma/migrations/20261020120000_progress_direct_sync/migration.sql` adds the direct progress-sync
path described below: one SECURITY DEFINER function (`save_my_progress`), one EXECUTE grant to
`authenticated`, and one SELECT policy limited to the caller's own row. It is additive — nothing is
dropped and no learner row is rewritten.

`prisma/migrations/20261007120000_profile_completeness_rls/migration.sql` is **additive**: three
nullable/defaulted columns, an `updated_at` trigger, a restatement of RLS + `REVOKE ALL` on all three
tables, deny-by-default policies, and an email backfill that only fills NULLs. It drops nothing and
rewrites no learner data. A commented rollback block is at the bottom of the file.

**Never** `prisma migrate reset`, `migrate dev` against production, or `db push`.

### `db:deploy` fails with P1001 "Can't reach database server"

Run `npm run db:check` first. `P1001` covers four unrelated faults that need opposite fixes, and the
checker separates them:

| What the checker reports | What it means | Fix |
|---|---|---|
| `socket open` then `NOT POSTGRES — answered the TLS handshake with a non-TLS record` | The hostname resolves and the **port accepts the connection**, but the service behind it is not Postgres. A **retired Supabase pooler** behaves exactly like this — which is why plain TCP reachability proves nothing. | Re-copy the connection strings from **Project Settings → Database → Connection string → URI**. Use **Session pooler** for `DATABASE_URL` and **Direct connection** for `DIRECT_URL`. The hostname format is `aws-<N>-<region>.pooler.supabase.com`; both `N` and the region can be stale. |
| `credentials REJECTED (P1000)` | The host is fine and Postgres answered — only the **password** (or the username form) is wrong. | Reset it at **Project Settings → Database → Reset database password**, then re-copy the URI. The pooler wants `postgres.<project-ref>`; the direct host wants plain `postgres`. |
| `socket timeout` / `DNS` | Nothing is listening, or the network blocks it. Note that `db.<ref>.supabase.co` is **IPv6-only**, so an IPv4-only network must use the pooler hostname. | Use the pooler, or enable IPv6. |
| `password contains a URL-special character with no %XX escape` | A password pasted unencoded: `@ : / ? #` inside it ends the URL early and the client sends a truncated credential. | Percent-encode those characters in the URI. |

### Sign-in works independently of the database

Supabase **Auth** and the Postgres **pooler** are separate services, and the app's mandatory sign-in
needs only Auth plus the Node API — both driven by keys, not by `DATABASE_URL`. So a broken database
connection does **not** break sign-in, and it must not be reported as if it did.

`npm run db:check` reports the two verdicts separately. The database is only required for
`npm run db:deploy` and for the **Prisma store** (server-side progress history and the sign-in log).
Without it, `server/db-config.mjs` selects the Supabase-Auth store and the product still works.

### Progress is collected in Supabase on EVERY deployment

The aggregate progress snapshot has TWO write paths that land in the SAME table
(`public.progress_snapshots`):

1. **The account API** (`/api/progress/snapshot`) when a deployment runs `server/index.mjs` — the
   server verifies the bearer token with Supabase and writes with the service key. Preferred when
   present; the owner dashboard and the sign-in log come from the same process.
2. **`save_my_progress`** (migration `20261020120000_progress_direct_sync`) when there is no API —
   a static host serves no `/api`. The client calls it through PostgREST after the API attempt
   fails. The function reads the caller from the signed JWT (`auth.uid()`), never from an argument,
   re-validates every counter and the lesson position exactly like `server/app.mjs`, and upserts ONE
   row: the caller's own. Table INSERT/UPDATE/DELETE stay revoked for clients; EXECUTE is granted to
   `authenticated` only. A SELECT policy on the same row lets a NEW device read its saved lesson
   position for "Continue Learning" without the API.

Both paths send only the aggregate counters plus the two-letter lesson position — never answers,
notes or code (see `scripts/tests/auth-progress.test.mjs`).

A build with `VITE_` config but a broken `DATABASE_URL` therefore behaves like this:

| Feature | Without a working database |
|---|---|
| Sign up / sign in / sign out | **Works** (Supabase Auth) |
| Password reset | **Works** |
| Courses, lessons, practice, labs | **Works** (content is bundled, progress is in the browser) |
| Owner dashboard | **Works** (read from Auth) |
| Progress snapshot → Supabase | **Works** once the migrations are applied (direct path) |
| Server-side progress history + sign-in log | **Not stored** |
| `db:deploy` | **Blocked** — needs the connection strings fixed |

## What is not implemented

- **MFA / 2FA.** Not configured and not in the UI.
- **Account deletion.** Not implemented; there is no self-service delete.
- **Server-side session storage.** supabase-js persists the session in browser storage; the server
  verifies the token on each request rather than holding a session of its own.
- **Email change.** Supabase Auth supports it, but no UI calls it.
