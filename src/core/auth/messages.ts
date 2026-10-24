/**
 * The account form's rules and wording — pure, so they can be tested without a browser.
 *
 * Supabase speaks to developers ("Invalid login credentials", "Email not confirmed"); a learner
 * needs to know what to DO next, in the language the rest of the product speaks. The mapping lives
 * here rather than inside the form so a test can hold every branch.
 */

export const MIN_PASSWORD = 8;

/**
 * How long the "Resend email" button waits before it will send again.
 *
 * Supabase already refuses a second confirmation for the SAME address inside 60 seconds, and the
 * project's sender allows only a couple of messages per hour in total — so a button that can be
 * pressed repeatedly is a button that spends the hour's budget in three clicks. The wait mirrors the
 * server's own window; it is a courtesy, not the limit (the server enforces that).
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Seconds left on that wait, given when the last message went out and the current clock.
 *
 * `0` means "send now"; it is also what an absent timestamp and a clock that moved backwards
 * resolve to, so the button can never lock itself out forever.
 */
export function resendWaitSeconds(sentAt: number, now: number): number {
  if (!sentAt) return 0;
  const elapsed = Math.max(0, Math.floor((now - sentAt) / 1000));
  return Math.max(0, Math.min(RESEND_COOLDOWN_SECONDS, RESEND_COOLDOWN_SECONDS - elapsed));
}

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
 * A confirmation (or recovery) link that is spent, past its hour, or already used once.
 *
 * Supabase returns this shape as `error=access_denied&error_code=otp_expired`, and reading only
 * `error` used to report it as "Sign-in was cancelled" — the opposite of what happened, because
 * nothing was cancelled: the learner clicked a real link and it no longer worked. One sentence,
 * exported, so the redirect reader and the error mapper cannot drift apart.
 */
export const EXPIRED_LINK_COPY =
  'That link has expired or was already used. Send yourself a new one and try again.';

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

/**
 * Does this failure mean the learner's only way forward is a NEW link?
 *
 * It reads the message the form is already showing — both the raw Supabase sentence and the copy
 * `authErrorCopy` produces — because those are the two shapes a failure reaches the screen in (a
 * thrown submit error, and a redirect that came back from an inbox link). When it is true the form
 * offers the resend itself instead of leaving the learner to guess that it exists.
 */
export function needsNewConfirmationLink(message: string | null | undefined): boolean {
  const text = (message ?? '').toLowerCase();
  return text.includes('not confirmed')
    || text.includes('otp_expired')
    || text.includes('email link is invalid')
    || text.includes('link has expired');
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
  if (text.includes('otp_expired') || text.includes('email link is invalid') || text.includes('link has expired')) {
    return EXPIRED_LINK_COPY;
  }
  if (text.includes('already registered') || text.includes('already been registered')) {
    return 'This email is already registered — sign in from the "Sign in" tab.';
  }
  /*
   * The sign-up mail has its own limit, and the size of it is not a guess: Supabase's built-in
   * sender allows TWO emails per PROJECT per hour (docs/guides/auth/rate-limits), and the quota is
   * only raisable with custom SMTP or a send-email hook. "Wait a few minutes" was therefore a
   * promise the project could not keep — the learner retried, failed again and reported the same
   * screen. The sentence names the real wait and the way out that costs no email at all: signing in
   * to the account whose confirmation is already sitting in an inbox. The operator-side fix belongs
   * in docs/AUTHENTICATION.md, not on screen.
   */
  if (text.includes('email rate limit') || text.includes('over_email_send_rate_limit')) {
    return "This project has used up its hourly confirmation emails. Wait about an hour, then try again — or sign in if you already created this account.";
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
