/**
 * The profile photo is a value from the OUTSIDE — a picked file, or a field inside an imported
 * progress file — and it ends up in an `<img src>`. This module is the one rule for what may live there.
 *
 * WHY A RULE IS NEEDED AT ALL, given the app draws the avatar on a canvas before storing it:
 *
 *   `importProgress` accepts a progress JSON the learner supplies. It spread that file's contents
 *   straight into application state (`{ ...defaultState(), ...parsed }`), so `profile.avatar` arrived
 *   from the file **without ever passing the canvas** — and nothing checked it. Three consequences,
 *   all real:
 *
 *     · a non-image scheme (`javascript:`, `data:text/html,…`) would be placed verbatim into the
 *       `src` of an `<img>`. Modern browsers do not execute script from an `<img>`, so this is not a
 *       live XSS here — but it is one `<img>`-to-`<iframe>` refactor away from being one, and it is
 *       never a legitimate value;
 *     · an SVG data URL is a document, not a bitmap, and an `<img>` is the only thing keeping its
 *       script inert;
 *     · there was NO SIZE CAP. `setState` serialises the whole `AppState` to localStorage on every
 *       single write, so a multi-megabyte avatar does not just bloat one field: it makes every future
 *       keystroke-batch write slow and can push the state past the localStorage quota, which silently
 *       stops progress being saved at all.
 *
 * Pure on purpose — no React, no store, no DOM — so a test can drive it directly.
 */

/** The image types a browser can render in an `<img>` and a canvas can safely re-encode. */
const ALLOWED_MIME = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

/**
 * The cap, in characters of the data URL.
 *
 * The app's own writer produces a 128×128 JPEG at quality .72 — roughly 6 KB, so ~8 KB of base64.
 * 64 KB is ~8× that: generous enough that a slightly larger avatar from an older release still
 * imports, tight enough that a hostile file cannot turn the state into megabytes.
 */
export const AVATAR_MAX_CHARS = 64 * 1024;

export type AvatarCheck =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'too-large' | 'not-an-image' };

/**
 * Is this string safe to put in an avatar `src`?
 *
 * A non-string, an empty string and anything that is not a base64 raster image data URL are all
 * rejected. The `value` returned is the ORIGINAL string (whitespace inside base64 is legal), so an
 * accepted avatar is never silently rewritten.
 */
export function checkAvatar(value: unknown): AvatarCheck {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, reason: 'empty' };
  if (value.length > AVATAR_MAX_CHARS) return { ok: false, reason: 'too-large' };
  if (!ALLOWED_MIME.test(value)) return { ok: false, reason: 'not-an-image' };
  return { ok: true, value };
}

/** Convenience for callers that only need the value: the avatar, or `''` when it is not usable. */
export function safeAvatar(value: unknown): string {
  const check = checkAvatar(value);
  return check.ok ? check.value : '';
}

/** The sentence a learner sees when an imported photo is refused. Absent means "no photo", not an error. */
export function avatarRejection(reason: 'empty' | 'too-large' | 'not-an-image'): string {
  return reason === 'too-large'
    ? `Profile photo ignored: it is larger than ${Math.round(AVATAR_MAX_CHARS / 1024)} KB.`
    : 'Profile photo ignored: it is not a PNG, JPEG, WebP or GIF image.';
}
