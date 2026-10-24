/**
 * Which account store this process runs.
 *
 * `prisma` (Postgres) is the richer one: it keeps the progress snapshot in a table and a real
 * sign-in log. It needs a working `DATABASE_URL`, and a connection string that still carries the
 * dashboard's placeholder is SILENTLY not a database — Prisma would fail every query at runtime
 * with an initialization error — so the value is checked here, once, at boot, instead of becoming a
 * 500 the learner sees later.
 *
 * `auth` (Supabase Auth) needs nothing but the keys the app already has. See auth-store.mjs.
 */

const PLACEHOLDER = /percent-encoded-password|your-|<[^>]+>/i;

/** True when the connection string looks like a real credential rather than a template. */
export function databaseConfigured(config = process.env) {
  const url = config.DATABASE_URL ?? '';
  if (!url.startsWith('postgres')) return false;
  if (PLACEHOLDER.test(url)) return false;
  try {
    const parsed = new URL(url);
    return Boolean(parsed.username) && Boolean(parsed.password) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export async function createStore({ config = process.env, admin } = {}) {
  if (databaseConfigured(config)) {
    const { createSupabaseStore } = await import('./store.mjs');
    return { store: createSupabaseStore(), label: 'prisma' };
  }
  const { createAuthStore } = await import('./auth-store.mjs');
  return { store: createAuthStore(admin), label: 'supabase-auth' };
}
