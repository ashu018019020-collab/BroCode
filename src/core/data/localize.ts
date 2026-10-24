import type { LocaleId } from '../../app/i18n/locales';

/**
 * The bilingual content model — one value, two languages.
 *
 * BroCode's learning content is authored, not generated: courses, tracks, sections, guides, packs,
 * questions and notebooks all live as JSON under `content/` (and the curriculum sections they build
 * on). Translating that corpus is a content project measured in thousands of strings, so the model
 * has to make a PARTIAL migration safe: an authored field is either
 *
 *   • a plain string — not translated yet, or langauge-neutral (a code sample, an id, an acronym), or
 *   • an `{ en, hi }` map — both languages authored, the reader picks.
 *
 * Both forms are legal at once, and `localize()` resolves them the same way. That is what lets the
 * corpus move one batch at a time — this batch, then the next — with no half-migrated screen and no
 * flag day: a field that has no Hinglish yet simply shows the English it had before.
 *
 * `hi` is Hinglish (Roman-script Hindi with the English technical vocabulary), never Devanagari.
 */
export type Localized<T = string> = T | { en: T; hi: T };

/** Is this authored value a language map rather than a plain value? */
export function isLocalized<T>(value: Localized<T>): value is { en: T; hi: T } {
  return typeof value === 'object' && value !== null && 'en' in value && 'hi' in value;
}

/**
 * The value in one language.
 *
 * Fallback order is `requested → English → the other one`, and an EMPTY string counts as missing:
 * an author who leaves `hi: ''` has not translated the field, and showing a blank line instead of
 * the English text would be worse than showing English. Anything that is not a language map comes
 * back untouched, so a field that was never migrated cannot break.
 */
export function localize<T>(value: Localized<T> | undefined | null, locale: LocaleId): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isLocalized(value)) return value;
  const requested = value[locale];
  if (typeof requested === 'string') return (requested.trim() ? requested : value.en) as T;
  return requested ?? value.en ?? value.hi;
}

/**
 * How much of an authored field is translated — the unit `npm run i18n:report` counts with.
 * `partial` is the honest state of a field that has an English value and an empty Hinglish one.
 */
export function localizationState<T>(value: Localized<T> | undefined): 'missing' | 'partial' | 'full' | 'plain' {
  if (value === undefined || value === null) return 'missing';
  if (!isLocalized(value)) return 'plain';
  const has = (v: T) => typeof v === 'string' ? Boolean(v.trim()) : v !== undefined && v !== null;
  const en = has(value.en);
  const hi = has(value.hi);
  if (en && hi) return 'full';
  if (en || hi) return 'partial';
  return 'missing';
}

/**
 * Localize a whole list of authored records, once: `{ name, description }` in, the same records
 * with those two fields resolved in the current language. Used by the readers so a page never
 * compares language codes itself.
 */
export function localizeFields<T extends Record<string, unknown>, K extends keyof T>(
  record: T,
  fields: readonly K[],
  locale: LocaleId,
): T {
  const out: Record<string, unknown> = { ...record };
  let changed = false;
  for (const field of fields) {
    const value = record[field] as Localized<unknown> | undefined;
    if (value !== undefined && isLocalized(value)) {
      out[field as string] = localize(value, locale);
      changed = true;
    }
  }
  return (changed ? out : record) as T;
}
