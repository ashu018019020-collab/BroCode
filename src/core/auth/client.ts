import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SERVICE_UNAVAILABLE_COPY } from './messages';
import { PUBLIC_SUPABASE_CONFIG } from './public-config';
import type { ProgressSummary } from './progress';

export type AccountRole = 'user' | 'admin';
export type AccountStatus = 'active' | 'disabled';
export type SignInProvider = 'email' | 'google' | 'github' | 'other';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  status: AccountStatus;
}

/**
 * The lesson position the account service remembers for this learner.
 *
 * It is a POSITION, not content: the section id and the stage name, validated on the server and
 * resolved against the live curriculum on the client before it can become a route.
 */
export interface ResumePosition {
  sectionId: string;
  stage: string;
}

/** A session restore always resolves BOTH halves: the account, and where to resume. */
export interface SessionResolution {
  user: AuthUser;
  resume: ResumePosition | null;
}

export interface UserProgress extends ProgressSummary {
  updatedAt: string;
}

export interface ManagedUser extends AuthUser {
  createdAt: string;
  lastSignInAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  progress: UserProgress | null;
}

export interface AdminUserResult {
  users: ManagedUser[];
  recentSignIns: {
    id: number;
    email: string;
    name: string;
    provider: SignInProvider;
    signedInAt: string;
  }[];
  summary: {
    total: number;
    online: number;
    active30Days: number;
  };
}

export interface RegistrationResult {
  user: AuthUser | null;
  emailConfirmationRequired: boolean;
}

/**
 * The short-lived credential for the optional OpenAI Realtime voice.
 *
 * `clientSecret` is an EPHEMERAL token minted by the server — never the permanent API key. It is
 * used once, in memory, to negotiate one WebRTC call; it is never written to localStorage or a log.
 */
export interface RealtimeVoiceSession {
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
  maxSessionSeconds: number;
}

/*
 * Typed as `SupabaseClient` (the SDK's default generics), NOT `ReturnType<typeof createClient>`:
 * the latter instantiates the Database parameter with `unknown`, which turns PostgREST calls
 * (`.from(...)`, `.rpc(...)`) into `never`. No Database types are generated for this project, so the
 * SDK default — an untyped schema — is exactly right.
 */
let client: SupabaseClient | undefined;

/**
 * A template value, not a credential: `.env.example` uses `https://your-project.supabase.co` and
 * `your-supabase-publishable-key`, and a deployment that copied the file without editing it must be
 * treated as UNCONFIGURED rather than handed to `createClient`, which would fail on every request
 * with a confusing network error instead.
 */
const PLACEHOLDER_RE = /your-project|your-supabase|changeme|replace-me|<[^>]+>/i;

/**
 * The browser-side Supabase config, or `null` when this build has none. Pure and exported so the
 * one place that decides "is the account service configured" is testable and shared by the client
 * and the provider-availability probe.
 *
 * Precedence: a real environment value first, then the committed PUBLIC fallback in production.
 * A placeholder copied from `.env.example` is treated as UNCONFIGURED in development rather than
 * silently connecting a developer to the production project; in production the public fallback is
 * exactly what keeps a missing hosting-dashboard variable from breaking every sign-in.
 */
export function browserSupabaseConfig(): { url: string; key: string } | null {
  const isUsable = (value: string | undefined): value is string =>
    typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER_RE.test(value);

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (isUsable(url) && isUsable(key)) return { url, key };

  if (import.meta.env.PROD
    && isUsable(PUBLIC_SUPABASE_CONFIG.url)
    && isUsable(PUBLIC_SUPABASE_CONFIG.publishableKey)) {
    return { url: PUBLIC_SUPABASE_CONFIG.url, key: PUBLIC_SUPABASE_CONFIG.publishableKey };
  }
  return null;
}

/**
 * The account service is optional: the whole platform works without it. This throws the SAME
 * sentence a learner would see for any other service outage — the missing variable names are a note
 * for whoever built the app (in the console), never a message for whoever is using it.
 */
function unavailable(): Error {
  console.error(
    '[BroCode] The account service is not configured for this build. Set VITE_SUPABASE_URL and '
    + 'VITE_SUPABASE_PUBLISHABLE_KEY in the root .env file and restart the dev server or rebuild.',
  );
  return new Error(SERVICE_UNAVAILABLE_COPY);
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const config = browserSupabaseConfig();
  if (!config) throw unavailable();
  const { url, key } = config;
  client = createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      /* PKCE is required here: this app routes with the URL hash, and the implicit flow returns its
         tokens in that same fragment. PKCE returns `?code=…` in the query string instead, which
         supabase-js exchanges for a session on load. */
      flowType: 'pkce',
    },
  });
  return client;
}

function authError(error: { message: string }): Error {
  return new Error(error.message || 'Supabase authentication failed.');
}

/**
 * The URL this deployment is actually served from, WITH its path.
 *
 * `window.location.origin` alone is wrong for a project-path deployment (this repository's own
 * sitemap targets `https://<owner>.github.io/BroCode/`): a confirmation or recovery link sent back
 * to the origin root lands on a 404, and — because the app is a hash-routed SPA — looks like a
 * broken email verification. Resolving `.` against `document.baseURI` keeps the `/BroCode/` part
 * without having to hardcode it, and works unchanged at a domain root.
 */
export function appBaseUrl(): string {
  try {
    if (typeof document !== 'undefined' && document.baseURI) {
      const base = new URL('.', document.baseURI);
      if (base.protocol === 'https:' || base.protocol === 'http:') return base.href;
    }
  } catch (error) {
    console.error('[BroCode] Could not resolve the application base URL.', error);
  }
  return `${window.location.origin}${import.meta.env.BASE_URL ?? '/'}`;
}

/**
 * Normalize a resume position from the account API. Nothing here is trusted into a route: the
 * resume engine checks the section against the curriculum and the stage against `STAGES`.
 */
function resumePosition(value: unknown): ResumePosition | null {
  if (!value || typeof value !== 'object') return null;
  const { sectionId, stage } = value as { sectionId?: unknown; stage?: unknown };
  if (typeof sectionId !== 'string' || !sectionId || typeof stage !== 'string' || !stage) return null;
  return { sectionId, stage };
}

/**
 * The resume position returned by the last successful sign-in/session restore.
 *
 * It is handed to `AuthProvider` AFTER the store has switched to the account's namespace — the
 * position belongs in that account's state, not in whatever namespace was active during the
 * network call. A module-level hand-off keeps that ordering explicit instead of racing a state
 * update inside the client.
 */
let pendingResume: ResumePosition | null = null;

export function takeRemoteResume(): ResumePosition | null {
  const resume = pendingResume;
  pendingResume = null;
  return resume;
}

/**
 * One account request, with a deadline.
 *
 * Without a timeout a stalled `fetch` left `applySession` awaiting forever: `loading` never became
 * false, `RequireAuth` rendered its skeleton indefinitely, and every protected page looked blank.
 * Ten seconds is long enough for a cold API and short enough that a broken one resolves to the
 * session-claims fallback instead of an infinite spinner.
 */
async function request<T>(path: string, init: RequestInit = {}, session?: Session | null): Promise<T> {
  let token = session?.access_token;
  if (!token) {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error) throw authError(error);
    token = data.session?.access_token;
  }
  if (!token) throw new Error('Sign in to continue.');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const signal = init.signal
    ?? (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(10_000)
      : undefined);
  const response = await fetch(path, { ...init, headers, ...(signal ? { signal } : {}) });
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error(`Account API returned HTTP ${response.status} without JSON; verify the API server is running.`);
  }
  let body: { error?: string } & T;
  try {
    body = await response.json() as { error?: string } & T;
  } catch {
    throw new Error('The account service returned an invalid response.');
  }
  if (!response.ok) throw new Error(body.error ?? `Account request failed (${response.status}).`);
  return body;
}

async function fetchCurrentUser(session: Session): Promise<SessionResolution> {
  // Server-verified profile when the account API is reachable: role comes from the database, so a
  // ban or promotion takes effect immediately instead of waiting for the token to refresh. The same
  // response carries the last lesson the account synced, which is how a new device resumes.
  try {
    const result = await request<{ user: AuthUser | null; resume?: ResumePosition | null }>(
      '/api/auth/session',
      {},
      session,
    );
    if (result.user) return { user: result.user, resume: resumePosition(result.resume) };
  } catch (error) {
    // The API server is not deployed alongside the static frontend (or is temporarily down). Fall
    // back to the signed Supabase session claims below so sign-in and email verification still
    // complete instead of surfacing "The account service is unavailable right now."
    console.warn('[BroCode] The account API was unreachable; using the signed session claims.', error);
  }
  // The profile comes from the signed claims; the resume position comes from the learner's OWN
  // Supabase row (RLS-limited), so a new device can still continue where it left off.
  return { user: profileFromSession(session), resume: await fetchOwnResumePosition(session.user.id) };
}

/**
 * Builds the app's account profile from a Supabase session's own, cryptographically-signed claims.
 *
 * No network call is required: `id`, `email`, `user_metadata.display_name` and
 * `app_metadata.brocode_role` are delivered inside the access token Supabase issues after a
 * successful sign-in, so they are as trustworthy as the session itself. This mirrors the server's
 * `profileFromAuthUser` (`server/auth-store.mjs`) so a static deployment behaves the same as an
 * API-backed one — role can only ever be `admin` when Supabase itself stamped it, which a client
 * cannot forge.
 */
export function profileFromSession(session: Session): AuthUser {
  // Supabase's public `User` type omits some fields the session can carry (banned_until), so the
  // session user is read through a superset type. Nothing here is forged: every value comes from a
  // Supabase-signed token.
  type SessionUser = Session['user'] & { banned_until?: string | null };
  const authUser = session.user as unknown as SessionUser;
  const metadata = authUser.user_metadata ?? {};
  const appMetadata = authUser.app_metadata ?? {};
  const named = metadata.display_name;
  const name =
    typeof named === 'string' && named.trim() ? named.trim() : (authUser.email ?? '').split('@')[0] ?? '';
  const role = appMetadata.brocode_role === 'admin' ? 'admin' : 'user';
  const now = Date.now();
  const status =
    authUser.banned_until && new Date(authUser.banned_until).getTime() > now ? 'disabled' : 'active';
  return {
    id: authUser.id,
    email: authUser.email ?? '',
    name,
    role,
    status,
  };
}

/**
 * The learner's own progress snapshot, written STRAIGHT to Supabase when the optional account API
 * is not deployed (a static host has no `/api`).
 *
 * The browser never names a user id: `save_my_progress` (migration 20261020120000) reads the caller
 * from the signed JWT (`auth.uid()`), re-validates every counter and the lesson position the same
 * way `server/app.mjs` does, and upserts ONE row — the caller's own. Table writes stay revoked for
 * clients; this RPC is the only direct-write path, so a forged body can never touch another
 * account's row. Returns true when the snapshot reached the database.
 */
async function saveProgressDirectly(
  progress: ProgressSummary & { lastSectionId?: string; lastStage?: string },
): Promise<boolean> {
  try {
    const { error } = await getSupabaseClient().rpc('save_my_progress', {
      xp: progress.xp,
      streak_current: progress.streakCurrent,
      practiced_count: progress.practicedCount,
      done_records: progress.doneRecords,
      study_minutes: progress.studyMinutes,
      study_days: progress.studyDays,
      open_mistakes: progress.openMistakes,
      last_section_id: progress.lastSectionId ?? null,
      last_stage: progress.lastStage ?? null,
    });
    if (error) throw authError(error);
    return true;
  } catch (error) {
    console.warn('[BroCode] Could not save the progress snapshot directly to Supabase.', error);
    return false;
  }
}

/**
 * The lesson position this account last synced, read from the learner's OWN snapshot row so a new
 * device can resume without the account API. Any failure — no row, no grant, no network — resolves
 * to null and the app falls back to its local history, exactly as before.
 */
async function fetchOwnResumePosition(userId: string): Promise<ResumePosition | null> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('progress_snapshots')
      .select('last_section_id, last_stage')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw authError(error);
    return resumePosition(
      data ? { sectionId: data.last_section_id, stage: data.last_stage } : null,
    );
  } catch (error) {
    console.warn('[BroCode] Could not read the saved lesson position from Supabase.', error);
    return null;
  }
}

export const authApi = {
  async session(session: Session | null): Promise<SessionResolution | null> {
    if (!session) return null;
    return fetchCurrentUser(session);
  },

  async login(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) throw authError(error);
    if (!data.session) throw new Error('Supabase sign-in did not return an active session.');
    const resolution = await fetchCurrentUser(data.session);
    pendingResume = resolution.resume;
    await authApi.recordSignIn(data.session, 'email').catch((cause: unknown) => {
      console.error('Could not record email sign-in activity.', cause);
    });
    return resolution.user;
  },

  /**
   * Create the account: NAME, email and password.
   *
   * The name is sent as `display_name` in the sign-up metadata, which is what the profile and the
   * dashboard show. Only when it is blank (it cannot be, the form requires it) does the address's
   * local part stand in — the same fallback the database trigger uses, so a row is never nameless.
   */
  async register(name: string, email: string, password: string): Promise<RegistrationResult> {
    const trimmed = email.trim();
    const displayName = name.trim() || trimmed.split('@')[0] || 'Learner';
    const { data, error } = await getSupabaseClient().auth.signUp({
      email: trimmed,
      password,
      options: {
        data: { display_name: displayName },
        // The deployment's real base path, not a bare origin: on a project-path deployment the
        // confirmation link must come back to `/BroCode/`, or it 404s and looks like a failed
        // verification. `appBaseUrl()` keeps a trailing slash for exactly this.
        emailRedirectTo: appBaseUrl(),
      },
    });
    if (error) throw authError(error);
    if (!data.session) return { user: null, emailConfirmationRequired: true };
    const resolution = await fetchCurrentUser(data.session);
    pendingResume = resolution.resume;
    await authApi.recordSignIn(data.session, 'email').catch((cause: unknown) => {
      console.error('Could not record account creation sign-in activity.', cause);
    });
    return { user: resolution.user, emailConfirmationRequired: false };
  },

  /** Re-send the signup confirmation link — the one screen a waiting learner actually needs. */
  async resendConfirmation(email: string): Promise<void> {
    const { error } = await getSupabaseClient().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: appBaseUrl() },
    });
    if (error) throw authError(error);
  },

  /**
   * Send the password-recovery email.
   *
   * `redirectTo` carries the app's base path plus a marker, because the recovery link has to come
   * back to the RESET screen rather than the shell: supabase-js reads the recovery token out of the
   * URL and establishes a short-lived session, and the learner is then asked for a new password.
   * Which screen handles it is decided from the URL by `passwordResetRequested()` in `reset.ts`, so
   * the marker is data, not a second router.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
      // Same base-path rule as the confirmation link; `appBaseUrl()` already ends in `/`.
      redirectTo: `${appBaseUrl()}?reset=1`,
    });
    if (error) throw authError(error);
  },

  /**
   * Set the new password for the session the recovery link established.
   *
   * There is no old password here on purpose: the learner arrived through the emailed recovery link,
   * and that link is the proof of ownership. `updateUser` is the supported SDK call for exactly this.
   */
  async updatePassword(password: string): Promise<void> {
    const { error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw authError(error);
  },

  async logout(): Promise<void> {
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw authError(error);
  },

  presence: () => request<{ user: AuthUser }>('/api/auth/presence', { method: 'POST' }),

  recordSignIn: (session: Session, provider: SignInProvider) => request<{ ok: true }>(
    '/api/auth/sign-in-event',
    { method: 'POST', body: JSON.stringify({ provider }) },
    session,
  ),

  users: () => request<AdminUserResult>('/api/admin/users'),

  /**
   * Mint a realtime voice session. The server decides the model, voice and instructions; the browser
   * only names the language. Requires a signed-in account (the route returns 401 otherwise).
   */
  voiceRealtime: (lang: 'en-IN' | 'hi-IN') => request<RealtimeVoiceSession>(
    '/api/voice/realtime/session',
    { method: 'POST', body: JSON.stringify({ lang }) },
  ),

  updateStatus: (id: string, status: AccountStatus) => request<{ ok: true }>(
    `/api/admin/users/${encodeURIComponent(id)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  ),

  /**
   * Store the aggregate snapshot — the account API when this deployment runs one, and Supabase
   * directly when it does not (a static host has no `/api`). Both paths land in the SAME table, so
   * "progress is collected in Supabase" is true on every deployment.
   */
  async saveProgress(progress: ProgressSummary & { lastSectionId?: string; lastStage?: string }): Promise<{ ok: true }> {
    try {
      return await request<{ ok: true }>('/api/progress/snapshot', {
        method: 'POST',
        body: JSON.stringify(progress),
      });
    } catch (error) {
      if (await saveProgressDirectly(progress)) return { ok: true };
      throw error;
    }
  },
};
