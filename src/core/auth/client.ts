import { createClient, type Session } from '@supabase/supabase-js';
import type { OAuthProvider } from './oauth';
import type { ProgressSummary } from './progress';

export type AccountRole = 'user' | 'admin';
export type AccountStatus = 'active' | 'disabled';

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

export const authApi = {
  async session(session: Session | null): Promise<AuthUser | null> {
    if (!session) return null;
    return fetchCurrentUser(session);
  },

  async login(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) throw authError(error);
    if (!data.session) throw new Error('Supabase sign-in did not return an active session.');
    return fetchCurrentUser(data.session);
  },

  async signInWithProvider(provider: OAuthProvider): Promise<void> {
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
    });
    if (error) throw authError(error);
  },

  async register(name: string, email: string, password: string): Promise<RegistrationResult> {
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
    return { user: await fetchCurrentUser(data.session), emailConfirmationRequired: false };
  },

  async logout(): Promise<void> {
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw authError(error);
  },

  presence: () => request<{ user: AuthUser }>('/api/auth/presence', { method: 'POST' }),

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
