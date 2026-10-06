/**
 * Per-route document metadata — the <title> and meta description for the route you are actually on.
 *
 * The app is one HTML document with hash-routed views, and index.html's canonical comment says so
 * deliberately: the canonical names the DOCUMENT. That was right, and it is also why every one of the
 * 43 routes shipped the SAME `<title>` and the SAME description: a browser tab, a bookmark, a
 * "save this link" sheet and the snippet a JS-rendering crawler prints all repeated the home page's
 * pitch, wherever the learner actually was. One document does not have to mean one title.
 *
 * The rule lives here and not in App.tsx for the reason the whole `core/` split exists: no `.tsx`
 * file can be loaded by the test suite (`scripts/tests/_ts-resolve.mjs` appends `.ts` for relative
 * specifiers only), while everything under `src/core/{learning,assessment,ai,platform}` is pure and
 * reachable. `App.tsx` holds only the effect that APPLIES what this returns.
 *
 * It also invents no copy. A route's title is the record `PAGES` already carries (the same one Ctrl+K
 * shows) and a lesson stage's description is `STAGE_META`'s authored blurb; nothing here writes a
 * second version of the app's pitch. Where there is nothing authored to say, `null` means "the
 * shell's own meta is already the honest answer for this route" — the home page above all.
 */

import { PAGES } from './search';
import { STAGE_META, type Stage } from '../learning/progress';

/**
 * The brand prefix the shell's own `<title>` leads with. It is duplicated on purpose — the shell is
 * HTML and this is code — and `scripts/tests/meta.test.mjs` reads `index.html` and fails if the two
 * ever drift, which is cheaper than a build step that injects one into the other.
 */
export const BRAND = 'BroCode';

export interface RouteMeta {
  /** Full `<title>` for the route, brand included. */
  title: string;
  /** The snippet under it — plain text, no HTML entities. */
  description: string;
}

/** Engines want the title short; the suite pins the same ceiling the shell's own `<title>` obeys. */
const title = (topic: string) => `${topic} — ${BRAND}`;

/** `numpy-pandas` → `Numpy Pandas`, the same humanising the breadcrumb does. */
const humanName = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The metadata for a pathname, or `null` when the shell's own meta already describes it.
 *
 * `ctx.sectionTitle` is how the lesson family says WHERE it is: a lesson page is `/lesson/<id>/<stage>`
 * and the section's title comes from the loaded curriculum, not from this module (which must stay
 * pure). App.tsx already resolves that string for the breadcrumb and passes it through, so the two
 * read the same — and without it the title degrades to `Lesson · Learn` rather than lying.
 */
export function routeMeta(pathname: string, ctx?: { sectionTitle?: string }): RouteMeta | null {
  // HashRouter hands us a clean pathname; a trailing slash is the same page.
  const p = (pathname || '/').replace(/\/+$/, '') || '/';

  // The home page: index.html's title/description ARE this route's metadata (and are pinned by
  // scripts/tests/sitemap.test.mjs). Returning null is what keeps them from being restated here.
  if (p === '/') return null;

  // Parameterised families first — their slugs never appear in PAGES, so a PAGES lookup cannot
  // answer for them and the breadcrumb had to grow a branch for each one for exactly this reason.
  if (p.startsWith('/lesson/')) {
    const stage = (p.split('/')[3] ?? 'learn') as Stage;
    const m = STAGE_META[stage] ?? STAGE_META.learn;
    return { title: title(`${ctx?.sectionTitle?.trim() || 'Lesson'} · ${m.label}`), description: m.blurb };
  }
  if (p.startsWith('/track/')) {
    const name = humanName(p.split('/')[2] ?? '');
    if (name) return { title: title(`${name} Track`), description: `All roadmap steps and lessons in the ${name} track.` };
  }
  if (p.startsWith('/course/')) {
    const slug = p.split('/')[2] ?? '';
    const step = p.split('/')[3] ?? '';
    const name = humanName(slug);
    if (name) {
      return step
        ? { title: title(`${name} · Step ${step}`), description: `Step ${step} of the ${name} course: its lessons, drills and labs.` }
        : { title: title(`${name} Course`), description: `Every step and lesson in the ${name} course, in roadmap order.` };
    }
  }

  const exact = PAGES.find((x) => x.route === p);
  if (exact) return { title: title(exact.title), description: exact.detail };

  // A sub-path of a registered screen is that screen. PAGES is in reading order, not length order,
  // so a `/question` route would otherwise win `/questions/12` — compare longest first and require
  // the separator, which is also what stops `/notes` claiming `/notes-archive`.
  const prefix = PAGES
    .filter((x) => x.route !== '/' && p.startsWith(`${x.route}/`))
    .sort((a, b) => b.route.length - a.route.length)[0];
  if (prefix) return { title: title(prefix.title), description: prefix.detail };

  // /onboarding, /login, /admin, the legacy slug aliases and anything unrouted: the shell's meta is
  // the truthful answer, and a generated sentence would be a claim nobody wrote.
  return null;
}
