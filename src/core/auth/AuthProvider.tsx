import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { authApi, getSupabaseClient, takePendingOAuthProvider, takeRemoteResume, type AuthUser, type RegistrationResult } from './client';
import { oauthErrorMessage, readOAuthCallback, withoutOAuthParams, type OAuthProvider } from './oauth';
import { announcePresence, broadcastSignIn } from './realtime';
import { summarizeProgress } from './progress';
import { SERVICE_UNAVAILABLE_COPY } from './messages';
import { stateSnapshot, useStore, adoptRemoteResume } from '../storage/store';
import { setStorageAccount } from '../storage/account';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  serviceError: string | null;
  progressSync: ProgressSyncState;
  /** A provider return that failed, read from the redirect URL before it is cleaned. */
  redirectError: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  loginWithProvider: (provider: OAuthProvider) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<RegistrationResult>;
  logout: () => Promise<void>;
}

interface ProgressSyncState {
  status: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
  lastSyncedAt: number | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * What the UI gets when the account service fails.
 *
 * The thrown error is the OPERATOR's: it can carry a status code, a provider payload or the name of
 * a variable this build was opened without. A learner can act on none of it, so the message is not
 * forwarded — it goes to the console, where the person who deployed the app can read it, and the
 * UI gets one sentence that is true whatever the cause was.
 */
function serviceFailure(error: unknown): string {
  console.error('[BroCode] The account service request failed.', error);
  return SERVICE_UNAVAILABLE_COPY;
}

function ProgressSync({
  userId,
  onStatusChange,
}: {
  userId: string;
  onStatusChange: (status: ProgressSyncState) => void;
}) {
  const state = useStore();
  const firstSyncForUser = useRef<string | null>(null);
  const lastSent = useRef('');
  const lastSyncedAt = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const firstSync = firstSyncForUser.current !== userId;
    if (firstSync) {
      firstSyncForUser.current = userId;
      lastSent.current = '';
      lastSyncedAt.current = null;
    }

    const timer = window.setTimeout(() => { void sync(); }, firstSync ? 0 : 800);
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    const syncWhenOnline = () => { void sync(); };
    document.addEventListener('visibilitychange', syncWhenVisible);
    window.addEventListener('online', syncWhenOnline);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', syncWhenVisible);
      window.removeEventListener('online', syncWhenOnline);
    };

    async function sync() {
      if (!navigator.onLine) {
        if (active) onStatusChange({ status: 'offline', lastSyncedAt: lastSyncedAt.current });
        return;
      }
      const summary = summarizeProgress(stateSnapshot());
      /**
       * The lesson position travels WITH the counters, so a device that has never opened a lesson
       * can still resume the one this account last read. It is two short strings — a section id and
       * a stage name — never an answer, a note or any content.
       */
      const current = stateSnapshot().learning ?? {};
      if (current.lastSectionId && current.lastStage) {
        Object.assign(summary, { lastSectionId: current.lastSectionId, lastStage: current.lastStage });
      }
      const serialized = JSON.stringify(summary);
      if (serialized === lastSent.current) return;
      if (active) onStatusChange({ status: 'syncing', lastSyncedAt: lastSyncedAt.current });
      try {
        await authApi.saveProgress(summary);
        lastSent.current = serialized;
        lastSyncedAt.current = Date.now();
        if (active) onStatusChange({ status: 'synced', lastSyncedAt: lastSyncedAt.current });
      } catch (error) {
        if (active) onStatusChange({ status: 'error', lastSyncedAt: lastSyncedAt.current });
        console.error('Could not sync the private progress summary to the account service.', error);
      }
    }
  }, [state, userId, onStatusChange]);

  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [progressSync, setProgressSync] = useState<ProgressSyncState>({ status: 'idle', lastSyncedAt: null });
  const [redirectError, setRedirectError] = useState<string | null>(() => {
    const callback = readOAuthCallback(window.location.search);
    return callback.error ? oauthErrorMessage(callback) : null;
  });

  useEffect(() => {
    let active = true;
    let sessionVersion = 0;
    let subscription: { unsubscribe: () => void } | undefined;
    /** The provider return, read before supabase-js consumes the `code` out of the URL. */
    const callback = readOAuthCallback(window.location.search);
    if (callback.error) takePendingOAuthProvider();

    const applySession = async (session: Session | null, version: number) => {
      if (!active || version !== sessionVersion) return;
      if (!session) {
        setStorageAccount(null);
        setUser(null);
        setServiceError(null);
        setProgressSync({ status: 'idle', lastSyncedAt: null });
        setLoading(false);
        return;
      }
      try {
        const resolution = await authApi.session(session);
        if (!active || version !== sessionVersion) return;
        if (!resolution?.user) {
          setStorageAccount(null);
          setUser(null);
          setServiceError(null);
          setProgressSync({ status: 'idle', lastSyncedAt: null });
          return;
        }
        setStorageAccount(resolution.user.id);
        // AFTER the namespace switch: the position belongs to this account's state.
        adoptRemoteResume(resolution.resume);
        setUser(resolution.user);
        setServiceError(null);
      } catch (error) {
        if (!active || version !== sessionVersion) return;
        setStorageAccount(null);
        setUser(null);
        setServiceError(serviceFailure(error));
        setProgressSync({ status: 'idle', lastSyncedAt: null });
      } finally {
        if (active && version === sessionVersion) setLoading(false);
      }
    };

    try {
      const supabase = getSupabaseClient();
      const initialVersion = ++sessionVersion;
      subscription = supabase.auth.onAuthStateChange((event, session) => {
        const version = ++sessionVersion;
        window.setTimeout(() => {
          void applySession(session, version);
          const provider = event === 'SIGNED_IN' && session ? takePendingOAuthProvider() : null;
          if (event === 'SIGNED_IN') {
            // One small broadcast on the shared realtime channel: the owner dashboard answers with
            // a single refetch instead of polling for sign-ins that already happened.
            void broadcastSignIn();
          }
          if (session && provider) {
            void authApi.recordSignIn(session, provider).catch((error: unknown) => {
              console.error(`Could not record ${provider} sign-in activity.`, error);
            });
          }
        }, 0);
      }).data.subscription;
      void supabase.auth.getSession()
        .then(async ({ data, error }) => {
          if (error) throw error;
          await applySession(data.session, initialVersion);
          if (callback.code || callback.error) {
            // Supabase strips `code` after a successful exchange; a spent code or a provider error
            // would otherwise replay on reload, so clear what is left of the redirect.
            const search = withoutOAuthParams(window.location.search);
            if (search !== window.location.search) {
              window.history.replaceState(
                window.history.state,
                '',
                `${window.location.pathname}${search}${window.location.hash}`,
              );
            }
          }
        })
        .catch((error: unknown) => {
          if (!active || initialVersion !== sessionVersion) return;
          setStorageAccount(null);
          setUser(null);
          setServiceError(serviceFailure(error));
          setProgressSync({ status: 'idle', lastSyncedAt: null });
          setLoading(false);
        });
    } catch (error) {
      sessionVersion += 1;
      setStorageAccount(null);
      setUser(null);
      setServiceError(serviceFailure(error));
      setLoading(false);
    }

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    // This session's half of the live dashboard: while it is open, every watcher sees this
    // account as Online — instantly, and gone the moment the tab or socket is.
    const releasePresence = announcePresence({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    const refreshPresence = async () => {
      if (!navigator.onLine) return;
      try {
        const result = await authApi.presence();
        if (active) {
          setUser(result.user);
          setServiceError(null);
        }
      } catch (error) {
        /**
         * Presence is OPTIONAL — it only marks this account "Online" on the owner dashboard.
         *
         * This used to call `serviceFailure`, which meant a static deployment without the optional
         * API showed "The account service is unavailable right now" on the sign-in form every
         * minute, even though Supabase sign-in, the session and the whole learning platform were
         * working. A failed heartbeat must never be reported as a failed account service; it is
         * logged for the operator and the session continues unchanged.
         */
        if (active) console.warn('[BroCode] Presence heartbeat failed; the session is unaffected.', error);
      }
    };

    void refreshPresence();
    const interval = window.setInterval(() => { void refreshPresence(); }, 60_000);
    document.addEventListener('visibilitychange', refreshPresence);
    return () => {
      active = false;
      releasePresence();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshPresence);
    };
  }, [user?.id]);

  const login = async (email: string, password: string) => {
    setRedirectError(null);
    const currentUser = await authApi.login(email, password);
    setStorageAccount(currentUser.id);
    // The client stashed the position returned by the session endpoint; adopt it into the account
    // namespace only if this device has no newer local position.
    adoptRemoteResume(takeRemoteResume());
    setUser(currentUser);
    setServiceError(null);
    return currentUser;
  };

  /** Hands the browser to the provider; the session arrives on the redirect back into the app. */
  const loginWithProvider = async (provider: OAuthProvider) => {
    setRedirectError(null);
    setServiceError(null);
    await authApi.signInWithProvider(provider);
  };

  const register = async (name: string, email: string, password: string) => {
    setRedirectError(null);
    const result = await authApi.register(name, email, password);
    if (result.user) {
      setStorageAccount(result.user.id);
      adoptRemoteResume(takeRemoteResume());
      setUser(result.user);
      setServiceError(null);
    }
    return result;
  };

  const logout = async () => {
    await authApi.logout();
    setStorageAccount(null);
    setUser(null);
    setProgressSync({ status: 'idle', lastSyncedAt: null });
  };

  return (
    <AuthContext.Provider value={{ user, loading, serviceError, progressSync, redirectError, login, loginWithProvider, register, logout }}>
      {user && <ProgressSync key={user.id} userId={user.id} onStatusChange={setProgressSync} />}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider.');
  return auth;
}
