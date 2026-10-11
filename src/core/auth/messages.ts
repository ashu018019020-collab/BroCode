/**
 * The account form's rules and wording — pure, so they can be tested without a browser.
 *
 * Supabase speaks to developers ("Invalid login credentials", "Email not confirmed"); a learner
 * needs to know what to DO next, in the language the rest of the product speaks. The mapping lives
 * here rather than inside the form so a test can hold every branch.
 */

export const MIN_PASSWORD = 8;

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
