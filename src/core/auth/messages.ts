/**
 * The account form's rules and wording — pure, so they can be tested without a browser.
 *
 * Supabase speaks to developers ("Invalid login credentials", "Email not confirmed"); a learner
 * needs to know what to DO next, in the language the rest of the product speaks. The mapping lives
 * here rather than inside the form so a test can hold every branch.
 */

export const MIN_PASSWORD = 8;

/**
 * The one sentence a learner sees when the account service itself cannot be reached.
 *
 * A missing environment variable, an unreachable API and a rejected key are the SAME problem to the
 * person reading it — none of them is something they can act on — so they get one calm sentence and
 * a "try again". The real cause belongs to the operator, and `console.error` (plus the server log)
 * is where it goes.
 */
export const SERVICE_UNAVAILABLE_COPY =
  'The account service is unavailable right now. Please try again in a little while.';

/**
 * Deployment detail wearing the clothes of an error message: an environment variable name, a
 * `.env` path, an HTTP status, the API not being up yet. None of it belongs on screen. This is a
 * LAST line of defence because the first one is upstream — a service failure is never handed to the
 * UI as a raw `error.message` — but the mapping function is the single funnel every auth message
 * passes through, so it is also the right place to make the rule total.
 */
const INTERNAL_DETAIL_RE = /VITE_[A-Z0-9_]+|SUPABASE_[A-Z0-9_]+|\.env\b|process\.env|publishable key|secret key|service[_ ]role|api server is running|without json|invalid response|http status|request failed \(\d/i;

/** Deliberately forgiving: something@something.tld, not an RFC 5322 parser. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function passwordProblem(value: string): string {
  if (value.length >= MIN_PASSWORD) return '';
  return `Use at least ${MIN_PASSWORD} characters.`;
}

/**
 * An unknown message passes through untouched — never swallowed, never replaced by a shrug. It is
 * the only thing that can tell a learner (or their administrator) what actually happened.
 */
export function authErrorCopy(message: string): string {
  const text = message.toLowerCase();
  if (INTERNAL_DETAIL_RE.test(message)) return SERVICE_UNAVAILABLE_COPY;
  if (text.includes('invalid login credentials')) {
    return 'Email or password is incorrect. Check it again, or use the "Create account" tab to create an account.';
  }
  if (text.includes('email not confirmed')) {
    return 'This email is not confirmed yet. Open the link we sent to your inbox, then sign in.';
  }
  if (text.includes('already registered') || text.includes('already been registered')) {
    return 'This email is already registered — sign in from the "Sign in" tab.';
  }
  if (text.includes('rate limit') || text.includes('too many requests')) {
    return 'Too many attempts. Wait a minute or two, then try again.';
  }
  if (text.includes('password should be at least') || text.includes('password is too short')) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (text.includes('unable to validate email') || text.includes('invalid email') || text.includes('invalid format')) {
    return "This email address doesn't look valid — check the spelling.";
  }
  if (text.includes('signups not allowed') || text.includes('signup is disabled')) {
    return 'New sign-ups are disabled for this project. Contact your administrator.';
  }
  return message;
}
