import { useEffect, useState } from 'react';
import { decodeIndex, type BankIndex, type RawBankIndex } from '../platform/searchindex';

/**
 * The question index, fetched at most once per session and only when something asks for it.
 *
 * The palette is the only consumer, and most sessions never open it — so this is a LAZY loader
 * (`useQuestionIndex(enabled)`), not a hook that fires on every page. Once fetched, `Public/sw.js`
 * keeps `/search/index.json` in its content cache like the other JSON packs, so Ctrl+K keeps
 * finding the whole bank with no network.
 */
let indexPromise: Promise<BankIndex | null> | null = null;

export const loadQuestionIndex = (): Promise<BankIndex | null> =>
  (indexPromise ??= fetch('./generated/search/index.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((raw: RawBankIndex) => decodeIndex(raw))
    .catch(() => null));

/**
 * `enabled` is what keeps the 1.6 MB index off the critical path: the palette passes `true` only
 * once it is open. While it loads, callers get `null` and must show their own loading state — an
 * empty result list and a still-loading index are different things, and the palette says which.
 */
export function useQuestionIndex(enabled: boolean): BankIndex | null {
  const [index, setIndex] = useState<BankIndex | null>(null);
  useEffect(() => {
    if (!enabled || index) return;
    let alive = true;
    loadQuestionIndex().then((d) => { if (alive) setIndex(d); });
    return () => { alive = false; };
  }, [enabled, index]);
  return index;
}
