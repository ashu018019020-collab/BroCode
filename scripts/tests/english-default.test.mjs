/**
 * English-first contract.
 *
 * The product may offer Hinglish, but English must be the official default and the authoritative
 * fallback. These assertions hold the decision in one place so a future "detect the browser
 * language" change cannot quietly make a Hindi browser skip the English product on first visit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const { DEFAULT_LOCALE, LOCALES, normalizeLocale, getPack } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'app', 'i18n', 'locales.ts')).href
);

test('English is the official default locale', () => {
  assert.equal(DEFAULT_LOCALE, 'en');
  assert.deepEqual(LOCALES.map((locale) => locale.code), ['en', 'hi']);
  assert.equal(LOCALES.find((locale) => locale.code === 'en').nativeName, 'English');
  assert.equal(LOCALES.find((locale) => locale.code === 'hi').nativeName, 'Hinglish');
});

test('a stored explicit choice is restored; unknown values fall back to English', () => {
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('hi'), 'hi');
  assert.equal(normalizeLocale('hinglish'), 'hi', 'the legacy id keeps a returning learner\'s choice');
  assert.equal(normalizeLocale('english'), 'en');
  assert.equal(normalizeLocale('de'), null);
  assert.equal(normalizeLocale(''), null);
});

test('first visit detection never reads the browser language', () => {
  const source = read('src/app/i18n/index.tsx');
  assert.doesNotMatch(source, /navigator\.language|navigator\.languages|localeFromLanguageTag/,
    'a device with no stored choice must start in English, not in its browser language');
  assert.match(source, /normalizeLocale\(stored\) \?\? DEFAULT_LOCALE/,
    'the only fallback after an explicit stored choice is the product default');
});

test('the language switcher is reachable globally and starts on English', () => {
  const shell = read('src/app/App.tsx');
  const header = shell.slice(shell.indexOf('<header className={`topbar'), shell.indexOf('</header>'));
  const aside = shell.slice(shell.indexOf('<aside'), shell.indexOf('</aside>'));
  assert.doesNotMatch(header, /LanguageToggle/, 'the header must not carry the language switch');
  assert.doesNotMatch(aside, /LanguageToggle/, 'the sidebar must not carry the language switch');
  assert.match(read('src/features/tools/Settings.tsx'), /<LanguageToggle \/>/, 'Settings renders the switch');
  assert.match(shell, /locale === 'hi' \? 'Switch to English' : 'Switch to Hinglish'/,
    'the quick-actions menu offers the same switch');
  const toggle = read('src/components/ui/LanguageToggle.tsx');
  assert.match(toggle, /LOCALES\.map/, 'the switch renders both real locale options');
  assert.match(toggle, /aria-pressed=\{locale === option\.code\}/, 'the active language is announced');
});

test('the English pack is the key contract and has no Hinglish leftovers', () => {
  const en = getPack('en');
  assert.ok(Object.keys(en).length > 300, 'the English pack defines the UI contract');
  const hinglishMarkers = /\b(karo|karein|nahi|abhi|kaise|chalao|likho|padho|banao|seekh|aap|tum)\b/i;
  const offenders = Object.entries(en)
    .filter(([, value]) => typeof value === 'string' && hinglishMarkers.test(value))
    .map(([key]) => key);
  assert.deepEqual(offenders, [], `English keys still carrying Hinglish: ${offenders.join(', ')}`);
});
