/**
 * One-time cleanup of the browser-TTS era.
 *
 * The voice used to be an ONNX model running on the device, cached in Cache Storage under
 * `brocode-supertonic3-<revision>` and configured by an unversioned `aiml:voice` key. That engine is
 * gone: synthesis happens on the BroCode server and the browser only receives WAV.
 *
 * This module removes exactly that debris — and nothing else. It never touches accounts, progress,
 * XP, attempts, notes, chat history, the service worker, or anything this app still reads.
 */

/** Written once the purge has run, so a reload does not walk the caches again. */
const MARKER = 'aiml:voice:v2:cleaned';

/** The Cache Storage names the device-side model used. */
const LEGACY_CACHE_PREFIX = 'brocode-supertonic3-';

/** The pre-v2 preference key; the v2 key supersedes it. */
const LEGACY_PREFS_KEY = 'aiml:voice';

/** The databases that could only belong to a device-side synthesiser. */
const LEGACY_DB = /^(supertonic|brocode-voice|brocode-tts|tts-models)/i;

/** True when this browser has any of the old voice's storage. Pure, for tests. */
export function hasLegacyVoiceStorage(cacheNames: readonly string[], dbNames: readonly string[], prefs: string | null): boolean {
  return (
    prefs !== null
    || cacheNames.some((name) => name.startsWith(LEGACY_CACHE_PREFIX))
    || dbNames.some((name) => LEGACY_DB.test(name))
  );
}

/**
 * Delete the old voice's storage. Safe to call on every load: it is a no-op after the first run and
 * every failure is swallowed, because a privacy cleanup must never break the page.
 */
export async function purgeLegacyVoiceStorage(): Promise<void> {
  try {
    if (localStorage.getItem(MARKER)) return;
    const cacheNames = typeof caches === 'undefined' ? [] : await caches.keys();
    const dbNames = await listDatabases();
    const prefs = localStorage.getItem(LEGACY_PREFS_KEY);
    if (hasLegacyVoiceStorage(cacheNames, dbNames, prefs)) {
      for (const name of cacheNames) {
        if (name.startsWith(LEGACY_CACHE_PREFIX)) await caches.delete(name);
      }
      for (const name of dbNames) {
        if (LEGACY_DB.test(name)) await deleteDatabase(name);
      }
      // The v2 preference was already read before this ran (or will be on the next load), so the
      // old key is dead weight the moment the new one exists.
      localStorage.removeItem(LEGACY_PREFS_KEY);
    }
    localStorage.setItem(MARKER, new Date().toISOString());
  } catch {
    /* Private mode, a blocked store, or a browser without Cache Storage — nothing to clean. */
  }
}

type DbList = { databases?: () => Promise<{ name?: string }[]> };

async function listDatabases(): Promise<string[]> {
  const idb = (globalThis as { indexedDB?: DbList }).indexedDB;
  if (!idb?.databases) return [];
  try {
    const found = await idb.databases();
    return found.map((db) => db.name).filter((name): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
