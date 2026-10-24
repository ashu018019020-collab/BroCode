import { useI18n } from '../../app/i18n';
import { LOCALES } from '../../app/i18n/locales';

/**
 * English | Hinglish — ONE control, on the Settings page and in the quick-actions menu. It is
 * deliberately NOT in the header or the sidebar: both are reserved for navigation and page actions,
 * and the language choice belongs with the rest of the account preferences.
 *
 * Three rules it exists to enforce, so no screen invents its own version:
 *
 *   1. Every option is named in ITS OWN language (`nativeName`). Someone who cannot read English
 *      has to be able to recognise "Hinglish" — and someone who wants English has to recognise
 *      "English" without reading Hinglish first.
 *   2. The active option is announced, not just coloured: `aria-pressed` plus a visible state, so a
 *      screen reader and a keyboard user both know which language is on.
 *   3. It never navigates and never resets anything. `setLang` swaps the packs in place, so the
 *      lesson, the scroll position and the answers on screen all stay exactly where they were.
 */
export function LanguageToggle({ variant = 'inline' }: { variant?: 'inline' | 'wide' }) {
  const { locale, setLang, t } = useI18n();
  return (
    <div
      className={`lang-switch ${variant}`}
      role="group"
      aria-label={t('lang.label')}
      title={t('lang.hint')}
    >
      {LOCALES.map((option) => (
        <button
          aria-pressed={locale === option.code}
          className={`lang-switch-btn${locale === option.code ? ' on' : ''}`}
          key={option.code}
          onClick={() => setLang(option.code)}
          type="button"
        >
          {option.nativeName}
        </button>
      ))}
    </div>
  );
}

export default LanguageToggle;
