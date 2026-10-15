/**
 * The bilingual NAME rule for curriculum sections — the pure half of the section-name overlay.
 *
 * Split from `core/data/curriculum-i18n.ts` for a concrete reason, not tidiness: that module fetches
 * the published overlay, so it imports `core/data/localize.ts`, and Node's test runner links module
 * graphs SYNCHRONOUSLY — `import('.../curriculum-i18n.ts')` fails with ERR_MODULE_NOT_FOUND on the
 * extensionless `./localize` import before the test-only resolver hook can act. The rule itself has
 * no runtime imports at all (the `Localized` shape is structural), so a test can load THIS file and
 * drive the real resolver with fixtures. `core/learning/courses.ts` exists for the same reason.
 *
 * WHERE THE LANGUAGE IS APPLIED: at the data boundary (`core/data/curriculum.tsx`), so every
 * component below receives a `Section` whose `title` is a plain string. No render site compares
 * language codes, and none can forget to translate a heading.
 */

/**
 * The authored Hinglish name map: `sectionId → name`.
 *
 * This is the shape of `content/curriculum/i18n/sections.json` (authored) as published to
 * `generated/curriculum/i18n.json` by `npm run i18n:sections:write`. Structural on purpose: no
 * import, so this module stays loadable by the test runner.
 */
export type SectionNameOverlay = Record<string, string>;

/** An `{ en, hi }` pair, as `core/data/localize.ts` defines it. Structural, so nothing is imported. */
type LocalizedText = { en: string; hi: string };

/** A section title as it may arrive from JSON: a plain string, or an authored bilingual map. */
export type SectionTitle = string | LocalizedText;

function isLocalizedTitle(value: unknown): value is LocalizedText {
  return !!value && typeof value === 'object' && 'en' in (value as LocalizedText) && 'hi' in (value as LocalizedText);
}

/**
 * One section's name, in the requested language.
 *
 * Precedence, most specific first:
 *
 *   1. an authored `{ en, hi }` title INSIDE the record — the general bilingual model, so the corpus
 *      can migrate into the JSON later and this overlay can be retired;
 *   2. the overlay's Hinglish name for this id;
 *   3. the English title the section already had.
 *
 * An empty or whitespace-only value at any step is treated as ABSENT, never as a name: a blank
 * heading is worse than the English one, and `"s01": ""` means "not translated yet", not "translate
 * it to nothing".
 */
export function resolveSectionTitle(
  section: { id: string; title: SectionTitle },
  locale: 'en' | 'hi',
  overlay: SectionNameOverlay | null | undefined,
): string {
  const authored = section.title;
  if (isLocalizedTitle(authored)) {
    const requested = locale === 'en' ? authored.en : authored.hi;
    if (typeof requested === 'string' && requested.trim()) return requested;
    const english = typeof authored.en === 'string' ? authored.en.trim() : '';
    return english || (typeof authored.hi === 'string' ? authored.hi : '');
  }
  const plain = typeof authored === 'string' ? authored : '';
  if (locale === 'en') return plain;
  const named = overlay?.[section.id];
  return typeof named === 'string' && named.trim() ? named : plain;
}

/**
 * Apply the name rule to a whole section list.
 *
 * Returns the SAME array when nothing changes (English, no overlay, or every name identical), so a
 * `useMemo` on the result keeps a stable identity and React never re-renders the tree for nothing.
 * Never mutates the input: the fetched curriculum stays the untouched cache the app re-reads when
 * the language changes.
 */
export function localizeSectionTitles<T extends { id: string; title: SectionTitle }>(
  sections: T[],
  locale: 'en' | 'hi',
  overlay: SectionNameOverlay | null | undefined,
): T[] {
  let changed = false;
  const out = sections.map((section) => {
    const title = resolveSectionTitle(section, locale, overlay);
    const current = typeof section.title === 'string' ? section.title : undefined;
    if (title === current) return section;
    changed = true;
    return { ...section, title };
  });
  return changed ? out : sections;
}
