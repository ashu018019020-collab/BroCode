/**
 * The Supabase-Auth-backed account store: the SAME interface as `store.mjs` (the Postgres one), so
 * `server/app.mjs` and its tests do not care which is running.
 *
 * Why it exists: every account feature the product needs is derivable from Supabase Auth itself —
 * identity, display name, role, ban state, sign-in time, provider. The Postgres tables add progress
 * HISTORY and a real sign-in log, which is strictly more, but they need a database password that
 * this deployment does not have yet. So the account system runs on the keys that ARE configured,
 * and switching to Postgres later is one branch in `index.mjs`, not a rewrite.
 *
 * Storage map (no schema of our own anywhere):
 *   name / role        → user_metadata.display_name, app_metadata.brocode_role (admin-only writes,
 *                        so a client cannot forge a role: the claim lives inside a Supabase-signed token)
 *   status             → banned_until (a disabled account is a banned account)
 *   progress snapshot  → user_metadata.brocode_progress (7 integers, rewritten whole; the read-modify-write
 *                        keeps GoTrue's merge semantics irrelevant)
 *   online             → an in-process presence map; "online" is a session fact, and a fresh process
 *                        legitimately has no evidence of anyone being online yet
 */
import { listAllAuthUsers } from './supabase.mjs';

const ROLE_KEY = 'brocode_role';
const PROGRESS_KEY = 'brocode_progress';
const PROGRESS_FIELDS = [
  'xp',
  'streakCurrent',
  'practicedCount',
  'doneRecords',
  'studyMinutes',
  'studyDays',
  'openMistakes',
];

function metadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function displayName(authUser) {
  const named = metadata(authUser.user_metadata).display_name;
  if (typeof named === 'string' && named.trim()) return named.trim();
  return (authUser.email ?? '').split('@')[0] ?? '';
}

export function providerOf(authUser) {
  const provider = authUser.app_metadata?.provider;
  if (provider === 'email' || provider === 'google' || provider === 'github') return provider;
  return 'other';
}

/** A GoTrue user record, as the API's profile shape. */
export function profileFromAuthUser(authUser, lastSeenAt = null, now = Date.now()) {
  return {
    id: authUser.id,
    name: displayName(authUser),
    role: metadata(authUser.app_metadata)[ROLE_KEY] === 'admin' ? 'admin' : 'user',
    status: authUser.banned_until && new Date(authUser.banned_until).getTime() > now
      ? 'disabled'
      : 'active',
    createdAt: new Date(authUser.created_at),
    lastSeenAt,
    email: authUser.email ?? '',
    progress: progressFromAuthUser(authUser),
  };
}

function progressFromAuthUser(authUser) {
  const stored = metadata(authUser.user_metadata)[PROGRESS_KEY];
  if (!stored || typeof stored !== 'object') return null;
  const progress = {};
  for (const field of PROGRESS_FIELDS) {
    const value = stored[field];
    if (!Number.isSafeInteger(value) || value < 0) return null;
    progress[field] = value;
  }
  progress.updatedAt = typeof stored.updatedAt === 'string' ? new Date(stored.updatedAt) : new Date(0);
  // The optional lesson position. A malformed pair is dropped rather than rejecting the whole
  // snapshot: the counters are still real progress, and a missing resume point only means the
  // dashboard falls back to its history.
  if (typeof stored.lastSectionId === 'string' && typeof stored.lastStage === 'string') {
    progress.lastSectionId = stored.lastSectionId;
    progress.lastStage = stored.lastStage;
  }
  return progress;
}

export function createAuthStore(admin, { now = () => Date.now() } = {}) {
  if (!admin) throw new TypeError('A Supabase admin client is required.');
  /** userId → epoch ms of the last presence ping seen by THIS process. */
  const presence = new Map();

  async function getUser(userId) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) {
      if (error.status === 404) return null;
      throw error;
    }
    return data.user ?? null;
  }

  async function mergeMetadata(userId, patch) {
    const current = await getUser(userId);
    if (!current) throw new Error(`Auth user ${userId} is missing.`);
    const { error } = await admin.auth.admin.updateUserById(userId, {
      // The whole object, not a patch: whatever GoTrue's merge rule is, the result is the same.
      user_metadata: { ...metadata(current.user_metadata), ...patch },
    });
    if (error) throw error;
  }

  return {
    name: 'supabase-auth',

    async close() {},

    async health() {
      // The one dependency this store has is the Auth service, so health means "Auth answers" —
      // one cheap page, never the whole user list.
      const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (error) throw error;
    },

    async getProfile(userId) {
      const authUser = await getUser(userId);
      if (!authUser) return null;
      const lastSeen = presence.get(userId);
      return profileFromAuthUser(authUser, lastSeen ? new Date(lastSeen) : null, now());
    },

    async touchProfile(userId, at = new Date()) {
      presence.set(userId, at.getTime());
    },

    /** No event log of our own — the panel is fed from each account's real `last_sign_in_at`. */
    async recordSignInEvent() {},

    async listRecentSignIns(limit = 50) {
      const users = await listAllAuthUsers(admin);
      return users
        .filter((user) => user.last_sign_in_at)
        .sort((a, b) => Date.parse(b.last_sign_in_at) - Date.parse(a.last_sign_in_at))
        .slice(0, limit)
        .map((user) => ({
          id: user.id,
          userId: user.id,
          name: displayName(user),
          provider: providerOf(user),
          signedInAt: new Date(user.last_sign_in_at),
        }));
    },

    async saveProgress(userId, progress, at = new Date()) {
      await mergeMetadata(userId, { [PROGRESS_KEY]: { ...progress, updatedAt: at.toISOString() } });
    },

    async listAdminUsers() {
      const users = await listAllAuthUsers(admin);
      return users.map((user) => {
        const lastSeen = presence.get(user.id);
        return profileFromAuthUser(user, lastSeen ? new Date(lastSeen) : null, now());
      });
    },

    /** Disabling an account is a Supabase ban: every token it holds stops working immediately. */
    async updateStatus(userId, status) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: status === 'disabled' ? '876000h' : 'none',
      });
      if (error) throw error;
      if (status === 'disabled') presence.delete(userId);
    },
  };
}
