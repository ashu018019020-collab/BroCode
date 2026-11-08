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
/**
 * What the index is doing right now.
 *
 * `null` from `useQuestionIndex` means both "still fetching" and "fetch failed", and the palette
 * reported the second as the first forever: a failed load kept saying "loading the full question
 * bank…". A failure is a verdict, so it gets its own state here and its own sentence there.
 */
export type QuestionIndexState = 'idle' | 'loading' | 'ready' | 'failed';

let indexState: QuestionIndexState = 'idle';
const watchers = new Set<() => void>();

function setIndexState(next: QuestionIndexState) {
  if (indexState === next) return;
  indexState = next;
  watchers.forEach((watch) => watch());
}

/** The state outside React (useful in a handler or a log). */
export const questionIndexState = (): QuestionIndexState => indexState;

/** The state inside React: re-renders when the fetch starts, lands or fails. */
export function useQuestionIndexState(): QuestionIndexState {
  const [value, setValue] = useState(indexState);
  useEffect(() => {
    const watch = () => setValue(indexState);
    watch();
    watchers.add(watch);
    return () => { watchers.delete(watch); };
  }, []);
  return value;
}

let indexPromise: Promise<BankIndex | null> | null = null;

export const loadQuestionIndex = (): Promise<BankIndex | null> =>
  (indexPromise ??= (() => {
    setIndexState('loading');
    return fetch('./generated/search/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw: RawBankIndex) => { const index = decodeIndex(raw); setIndexState('ready'); return index; })
      .catch(() => {
        // Forget the rejected promise so the NEXT palette open really does retry — the palette
        // promises exactly that, and a memoised failure would make that sentence a lie.
        indexPromise = null;
        setIndexState('failed');
        return null;
      });
  })());

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
