/**
 * The password-recovery return trip — pure, so it can be tested and so no component has to
 * re-implement the rule.
 *
 * HOW SUPABASE DELIVERS A RECOVERY LINK, and why this module exists at all:
 *
 *   `resetPasswordForEmail` mails a link back to `redirectTo`. supabase-js (with `detectSessionInUrl`)
 *   then reads the credential out of the URL and — on success — establishes a real, short-lived
 *   session before our code runs. The learner must now be asked for a NEW password, and that is a
 *   different screen from the shell.
 *
 *   The credential arrives in one of two shapes depending on the flow, and BOTH have to be handled
 *   or a real learner gets a dead page:
 *
 *     · PKCE (this app's configured flow, `flowType: 'pkce'`): `?code=…` in the QUERY string.
 *     · The implicit fallback some Supabase configurations still send: `#access_token=…&type=recovery`
 *       in the HASH FRAGMENT.
 *
 *   The hash matters more than usual here because this app uses a HashRouter: its own routes live in
 *   that same fragment. A recovery fragment and a route are therefore both "the hash", and
 *   `#access_token=…&type=recovery` must NOT be read as a route.
 *
 * `?reset=1` is our own marker (set as `redirectTo` when the email is requested). It makes the
 * pending state survive even when Supabase strips its parameters after consuming them, which is
 * exactly the case where the learner would otherwise be dumped on the dashboard mid-recovery.
 */

/** supabase-js may deliver the recovery credential in the query (PKCE) or the fragment (implicit). */
export function passwordResetRequested(url: { search: string; hash: string }): boolean {
  const search = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const query = new URLSearchParams(search);
  // PKCE: the code exchange happens in the SDK; we only need to know a recovery is in flight.
  if (query.get('reset') === '1') return true;
  if (query.get('type') === 'recovery' && query.has('code')) return true;

  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  if (!fragment) return false;
  // A HashRouter route looks like `/lesson/s01/learn`. Only a recovery fragment is `k=v&k=v`.
  if (!fragment.includes('=')) return false;
  const hash = new URLSearchParams(fragment);
  if (hash.get('type') === 'recovery') return true;
  if (hash.get('error') === 'access_denied') return true;
  // A bare recovery token (`#access_token=…`) with no `type` still means "this is a recovery link".
  return hash.has('access_token') && !hash.has('type');
}

/** The reason a recovery link failed, if the provider said so. `null` when it did not. */
export function passwordResetError(url: { hash: string; search: string }): string | null {
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const hash = fragment.includes('=') ? new URLSearchParams(fragment) : null;
  const search = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const query = new URLSearchParams(search);
  const code = hash?.get('error_code') ?? query.get('error_code');
  const description = hash?.get('error_description') ?? query.get('error_description');
  if (!code && !description) return null;
  // Supabase's own sentence is shown: it describes an expired or already-used link in words a
  // learner can act on ("Email link is invalid or has expired"), and it carries no account detail.
  return description
    ? description.replace(/\+/g, ' ')
    : 'This password reset link is invalid or has expired. Request a new one.';
}

/**
 * Strip the recovery credential from the address bar once it has been consumed.
 *
 * Two reasons, and the second is a security one: a refresh must not replay a spent link, and the
 * fragment must not sit in the URL where a screenshot, a shared screen or the browser history keeps
 * a live credential. Only recovery parameters are removed — a HashRouter route is left alone.
 */
export function withoutResetParams(url: { pathname: string; search: string; hash: string }): string {
  const search = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const query = new URLSearchParams(search);
  query.delete('reset');
  query.delete('code');
  query.delete('type');
  query.delete('error');
  query.delete('error_code');
  query.delete('error_description');
  const nextSearch = query.toString();

  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  let nextHash = url.hash;
  if (fragment.includes('=')) {
    const hash = new URLSearchParams(fragment);
    if (hash.has('access_token') || hash.get('type') === 'recovery' || hash.has('error')) {
      hash.delete('access_token');
      hash.delete('refresh_token');
      hash.delete('expires_in');
      hash.delete('expires_at');
      hash.delete('token_type');
      hash.delete('type');
      hash.delete('error');
      hash.delete('error_code');
      hash.delete('error_description');
      const rest = hash.toString();
      nextHash = rest ? `#${rest}` : '';
    }
  }
  return `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`;
}
