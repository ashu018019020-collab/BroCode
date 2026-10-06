/**
 * Supabase OAuth return path — pure parsing only, so the redirect contract is testable without a
 * browser or a provider. The browser half lives in `client.ts`/`AuthProvider.tsx`.
 *
 * A PKCE sign-in returns `?code=…`, which `@supabase/supabase-js` exchanges for a session and
 * removes from the URL itself. A provider that fails or is cancelled returns
 * `?error=…&error_description=…` instead, which the library ignores — that one is ours to read,
 * show, and clean up.
 */

export type OAuthProvider = 'github' | 'google';

export interface OAuthCallback {
  code: string | null;
  error: string | null;
  errorDescription: string | null;
}

/** One-shot parameters added by Supabase or the provider; a reload must not replay them. */
const OAUTH_PARAMS = ['code', 'state', 'error', 'error_code', 'error_description'];

function param(search: string, key: string): string | null {
  const value = new URLSearchParams(search).get(key);
  return value && value.trim() ? value : null;
}

export function readOAuthCallback(search: string): OAuthCallback {
  return {
    code: param(search, 'code'),
    error: param(search, 'error'),
    errorDescription: param(search, 'error_description'),
  };
}

/**
 * Drops the OAuth parameters from a search string while keeping anything else. Returns `''` when
 * nothing is left, otherwise a `?a=b` string, so callers can rebuild the URL as-is.
 */
export function withoutOAuthParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of OAUTH_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** The sentence the login page shows for a provider return that did not produce a session. */
export function oauthErrorMessage(callback: OAuthCallback): string {
  if (callback.error === 'access_denied') {
    return 'Sign-in was cancelled. Try again, or continue as guest.';
  }
  const description = callback.errorDescription?.trim();
  return description
    ? `Sign-in failed: ${description}`
    : 'The sign-in provider could not complete the request. Try again, or use email.';
}
