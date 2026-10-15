import type { Section } from '../../types';
import type { LocaleId } from '../../app/i18n/locales';
import { localizeSectionTitles, type SectionNameOverlay } from '../learning/section-names';

/**
 * The authored Hinglish NAME overlay for curriculum sections — the data-access half.
 *
 * WHY THIS EXISTS AS AN OVERLAY, and not as a bilingual `title` inside
 * `public/generated/curriculum/sections.json`:
 *
 *   `sections.json` is extracted from the source PDF by `tools/extract.mjs`, and then repaired
 *   IN PLACE by four more scripts — `learn.cjs`, `stages.cjs`, `guides.cjs` and `packs.cjs` all write
 *   that same file, and `npm run stages` literally prints "input, transformed data, or output?"
 *   while deciding what to edit. A translation authored inside it survives exactly until the next
 *   extraction. This is the same reason `content/curriculum/stage-overrides.json` exists.
 *
 * So ownership is split deliberately, and the split is the point:
 *
 *   · `content/curriculum/i18n/sections.json` — the single authored source for a section's HINGLISH
 *     name. Hand-edited, reviewed, batched.
 *   · `public/generated/curriculum/sections.json` — the single source for everything else about a
 *     section: its `id`, its number, its English content, its concepts and its questions.
 *   · `public/generated/curriculum/i18n.json` — the published merge the browser actually reads
 *     (`npm run i18n:sections:write`).
 *
 * The RULE (precedence, blank handling, no-op identity) lives in `core/learning/section-names.ts`,
 * which has no runtime imports so a test can drive it with fixtures. This file only fetches.
 */

let overlayPromise: Promise<SectionNameOverlay | null> | null = null;

/**
 * The overlay, fetched once per session and cached as the PROMISE (not the result) so two callers
 * cannot race a second request for the same few KB.
 *
 * A missing, offline or corrupt overlay is NOT an error: it resolves to `null`, which degrades to
 * "no Hinglish names yet" — the honest state of a partially translated corpus — and it keeps the app
 * fully offline-capable, because a translation can never be the reason a learner sees no lesson.
 */
export const loadSectionsOverlay = (): Promise<SectionNameOverlay | null> =>
  (overlayPromise ??= fetch('./generated/curriculum/i18n.json')
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((doc: { version?: number; sections?: unknown } | null) => {
      const sections = doc?.sections;
      if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return null;
      const out: SectionNameOverlay = {};
      for (const [id, value] of Object.entries(sections as Record<string, unknown>)) {
        // Filtering here means the boundary below never has to ask whether a value is usable.
        if (typeof value === 'string' && value.trim()) out[id] = value.trim();
      }
      return Object.keys(out).length ? out : null;
    })
    .catch(() => null));

/** Apply the name rule to a whole section list, in the requested language. */
export function localizeSections(
  sections: Section[],
  locale: LocaleId,
  overlay: SectionNameOverlay | null,
): Section[] {
  return localizeSectionTitles(sections, locale, overlay);
}

export type { SectionNameOverlay };
