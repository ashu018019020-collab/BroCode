# Supabase account service

Visitors must sign in before entering the learning app. Supabase Auth handles email/password and
OAuth accounts; PostgreSQL stores protected account profiles, sign-in activity, and summary-only
progress snapshots. Private answers, notes, and saved code stay in the browser and are not synced.

## Configure Supabase

Copy the root [`.env.example`](../.env.example) to `.env` if you do not already have one, then set:

- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: project URL and publishable key. The `VITE_`
  copies are public and used by the browser for Supabase Auth.
- `SUPABASE_SECRET_KEY`: server-only key. It is used only by the Node API for Supabase Auth Admin
  operations. Never expose it through a `VITE_*` variable or commit it.
- `DATABASE_URL`: Supabase shared transaction-pooler URL on port `6543`, with `pgbouncer=true`.
- `DIRECT_URL`: Supabase session-pooler URL on port `5432`, used by Prisma migrations.
- `WEB_ORIGIN`: exact app origin; defaults to `http://localhost:5173` for local development, and must be `https://` in production.
- `ENFORCE_HTTPS`: on in production (`NODE_ENV=production`), off otherwise. See "HTTPS enforcement".
- `BOOTSTRAP_ADMIN_EMAIL`: the confirmed Supabase Auth email to make the initial owner.

Replace the database password placeholders in both pooler URLs. Percent-encode special characters
in the password. `.env` is ignored by Git. The database password and Secret key were previously
shared in chat; rotate both in the Supabase dashboard before using this integration.

In Supabase Auth URL Configuration, allow the local app URL (`http://localhost:5173`) and the
production app URL as redirect URLs. Email confirmation follows the project's Supabase Auth
settings. To allow 8-character passwords, set the minimum password length to `8` in the Supabase
Dashboard under Authentication → Settings → Password Requirements. The app's sign-up form also
requires at least 8 characters.

### HTTPS enforcement

Node terminates no TLS here: in production the API sits behind the proxy that owns the certificate,
so that proxy must forward `X-Forwarded-Proto: https`. When enforcement is on and the API can see
that a request arrived over TLS, every response — including the CORS preflight — carries
`Strict-Transport-Security: max-age=15552000`, and a request that arrived as plain HTTP is answered
with `308` to the same method, path, and query string on `https://`, so an upgrade never loses a
`POST` body. Enforcement is off for local development, and `ENFORCE_HTTPS=off` disables it in
production as well — use it only when the proxy terminates TLS without forwarding
`X-Forwarded-Proto`, because then the API would otherwise redirect a request to itself.

## Enable GitHub and Google sign-in

The sign-in page starts provider sign-in with `signInWithOAuth` and returns to the site root, where
the existing `AuthProvider` picks up the session. Providers are configured in the Supabase
dashboard, not in this repository — no new environment variables and no new server endpoints:

1. Create the provider apps. GitHub: Settings → Developer settings → OAuth Apps. Google: Google
   Cloud → APIs & Services → Credentials → OAuth client ID. Both use the callback URL
   `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Supabase Dashboard → Authentication → Providers: enable GitHub and Google, then paste each
   client ID and secret. Supabase stores them; the browser never sees them.
3. Authentication → URL Configuration: add `http://localhost:5173` and the production origin to
   Redirect URLs. The app returns to the origin root (`?code=…`) rather than a hash route, because
   the app routes with the URL hash.

The project uses the PKCE flow (`flowType: 'pkce'`), so the return carries a one-time code that
supabase-js exchanges for the session before the app renders the signed-in state. A cancelled or
failed provider return shows its reason on the sign-in page. Completing the sign-in still needs a
reachable database: the redirect lands on `AuthProvider`, which reads the profile through
`/api/auth/session`, so `DATABASE_URL` must hold a real password before a provider sign-in can finish.

## Apply the database schema

From the repository root, one command validates the environment and Prisma schema, applies the
pending migration, generates the client, and health-checks the API:

```powershell
npm install
npm run db:setup
```

It stops before any network call while `.env` still holds the `percent-encoded-password`
placeholders, and it classifies Prisma failures (unreachable host, wrong password, migration
already applied, schema drift) with the next action. Options:

```powershell
npm run db:setup -- --check      # env + schema + migration status only; no writes, no API start
npm run db:setup -- --keep-api   # leave the API dev server running after a healthy check
npm run db:setup -- --admin      # bootstrap the owner account after a healthy check
```

If the shared pooler host reports `P1001`, switch to the project's direct host
(`db.<project-ref>.supabase.co:5432`); remove `?pgbouncer=true` when you leave the pooler.

The migrations create profiles for existing Supabase Auth users and new sign-ups, plus
summary-only progress snapshots and sign-in events. Each public table has RLS enabled and no
`anon`/`authenticated` table grants. The API uses the server-side Prisma connection; browser
clients cannot read other users' records.

## Bootstrap the owner

First create and confirm the owner account through the app's shared sign-in page. Set
`BOOTSTRAP_ADMIN_EMAIL` in the local `.env` to that exact email and run once:

```powershell
npm run bootstrap:admin
```

The command refuses to run if any admin already exists. Admin status is stored in `profiles`, not
user-editable Auth metadata. Regular users cannot promote themselves or other users to admin.

## Run locally

Start the API and Vite in separate terminals:

```powershell
npm run dev:api
npm run dev
```

Vite proxies `/api` to `http://localhost:8787`. Check the API and database connection at
`http://localhost:8787/api/health`; a successful response reports both as `ok`.

## Owner dashboard

Sign in through the same page as learners. The owner role unlocks `/#/admin`; the server checks the
database-backed role on every admin request. The dashboard shows account identity, recent sign-in
events and their method (email/password, Google, or GitHub), last sign-in, online presence (last
seen within two minutes), last-30-day sign-ins, and privacy-limited learning metrics. It can disable
or re-enable a learner account but cannot grant admin privileges.
The recent-event list begins after the sign-in-events migration is deployed; Supabase's existing
last-sign-in timestamp remains available for earlier accounts.

Sign-in is required to use learning pages. Progress metrics are sent after a quiet period while
online and include XP, streak, practice/completion counts, study time/days, and open mistakes.
Answer text, notes, saved code, bookmarks, and detailed records remain local.

Accounts and passwords from the old Oracle-backed account service are not migrated. Learners must
create Supabase Auth accounts. Existing guest data stays under the original browser-local keys;
after sign-in, private app state, exam answers, assistant conversations, and Playground files use
separate per-account browser-local keys. Switching accounts never assigns guest data to an account.

## AI voice (server-side TTS)

The tutor's voice is generated on the server; the browser downloads no model and holds no provider key.

- **There is no server voice.** The tutor speaks with the browser's own speech synthesiser, so
  this API has no text-to-speech route and needs no model, no key and no voice host. The Supertonic 3
  service, its Docker image, its Vercel proxy and the `TTS_SERVICE_*` variables were removed.

## Tests

The focused API tests use in-memory Auth and store doubles. They cover role enforcement, activity,
summary-only progress writes, and expiring access:

```powershell
npm run test:auth
```

The repository gates are `npm run typecheck`, `npm test`, and `npm run build`.
