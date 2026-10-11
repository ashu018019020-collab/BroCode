import { createClient, type Session } from '@supabase/supabase-js';
import { enabledProviders, type OAuthProvider, type ProviderAvailability } from './oauth';
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

let client: ReturnType<typeof createClient> | undefined;
const PENDING_OAUTH_KEY = 'brocode:pending-oauth-provider';

export function getSupabaseClient() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || url.includes('your-project-ref') || key.includes('your-supabase-')) {
    throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the root .env file.');
  }
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
  const response = await fetch(path, { ...init, headers });
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

async function fetchCurrentUser(session: Session): Promise<AuthUser> {
  const result = await request<{ user: AuthUser | null }>('/api/auth/session', {}, session);
  if (!result.user) throw new Error('The account profile is unavailable. Contact the administrator.');
  return result.user;
}

/**
 * The project's enabled providers, asked for once per session (the settings endpoint is public and
 * takes the publishable key). Cached at module level so opening the dialog twice is one request.
 * `null` means "could not find out" — see `enabledProviders` for why that is not "none".
 */
let providerAvailability: Promise<ProviderAvailability | null> | undefined;

export function loadProviderAvailability(): Promise<ProviderAvailability | null> {
  if (!providerAvailability) {
    providerAvailability = (async () => {
      try {
        const url = import.meta.env.VITE_SUPABASE_URL;
        const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) return null;
        const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
        if (!response.ok) return null;
        return enabledProviders(await response.json());
      } catch (error) {
        console.error('Could not read the Supabase provider settings.', error);
        return null;
      }
    })();
  }
  return providerAvailability;
}

export function takePendingOAuthProvider(): OAuthProvider | null {
  let pending: string | null;
  try {
    pending = window.sessionStorage.getItem(PENDING_OAUTH_KEY);
    window.sessionStorage.removeItem(PENDING_OAUTH_KEY);
  } catch (error) {
    console.error('Could not read the pending OAuth provider.', error);
    return null;
  }
  if (!pending) return null;
  try {
    const value = JSON.parse(pending) as { provider?: unknown; startedAt?: unknown };
    const age = typeof value.startedAt === 'number' ? Date.now() - value.startedAt : -1;
    if (
      (value.provider === 'google' || value.provider === 'github')
      && age >= 0
      && age <= 15 * 60_000
    ) return value.provider;
  } catch {
    return null;
  }
  return null;
}

export const authApi = {
  async session(session: Session | null): Promise<AuthUser | null> {
    if (!session) return null;
    return fetchCurrentUser(session);
  },

  async login(email: string, password: string): Promise<AuthUser> {
    takePendingOAuthProvider();
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) throw authError(error);
    if (!data.session) throw new Error('Supabase sign-in did not return an active session.');
    const user = await fetchCurrentUser(data.session);
    await authApi.recordSignIn(data.session, 'email').catch((cause: unknown) => {
      console.error('Could not record email sign-in activity.', cause);
    });
    return user;
  },

  async signInWithProvider(provider: OAuthProvider): Promise<void> {
    try {
      window.sessionStorage.setItem(PENDING_OAUTH_KEY, JSON.stringify({ provider, startedAt: Date.now() }));
    } catch (error) {
      console.error('Could not persist the pending OAuth provider.', error);
    }
    try {
      const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
      });
      if (error) throw authError(error);
    } catch (error) {
      try {
        window.sessionStorage.removeItem(PENDING_OAUTH_KEY);
      } catch (storageError) {
        console.error('Could not clear the pending OAuth provider.', storageError);
      }
      throw error;
    }
  },

  async register(name: string, email: string, password: string): Promise<RegistrationResult> {
    takePendingOAuthProvider();
    const { data, error } = await getSupabaseClient().auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw authError(error);
    if (!data.session) return { user: null, emailConfirmationRequired: true };
    const user = await fetchCurrentUser(data.session);
    await authApi.recordSignIn(data.session, 'email').catch((cause: unknown) => {
      console.error('Could not record account creation sign-in activity.', cause);
    });
    return { user, emailConfirmationRequired: false };
  },

  /** Re-send the signup confirmation link — the one screen a waiting learner actually needs. */
  async resendConfirmation(email: string): Promise<void> {
    const { error } = await getSupabaseClient().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
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

  updateStatus: (id: string, status: AccountStatus) => request<{ ok: true }>(
    `/api/admin/users/${encodeURIComponent(id)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  ),

  saveProgress: (progress: ProgressSummary) => request<{ ok: true }>('/api/progress/snapshot', {
    method: 'POST',
    body: JSON.stringify(progress),
  }),
};
