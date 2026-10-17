/**
 * PUBLIC browser bootstrap values for Supabase.
 *
 * WHY THIS FILE EXISTS
 *
 * Supabase's publishable (formerly "anon") key is DESIGNED to be shipped to the browser: it is
 * protected by Row Level Security, not by secrecy. The service-role/secret key is the one that must
 * never appear here or anywhere in the client bundle.
 *
 * A static deployment that is built without Vercel environment variables used to fail every
 * sign-in with "The account service is unavailable right now" because `createClient` was never
 * given a URL or key. `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` still take precedence
 * when present (and are the recommended configuration), but these public values are a safe fallback
 * so a production build cannot lose authentication just because a build variable was not copied
 * into the hosting dashboard.
 *
 * NEVER put SUPABASE_SECRET_KEY, the database password, or any token in this file. The project's
 * bundle scan (`scripts/tests/production-readiness.test.mjs`) fails if a secret key reaches `dist/`.
 */
export const PUBLIC_SUPABASE_CONFIG = {
  url: 'https://xaozsqwjmblebnscdbka.supabase.co',
  publishableKey: 'sb_publishable_p0YLwR24cOUSnH37yUuSzw_Eb7GE4Cp',
} as const;
