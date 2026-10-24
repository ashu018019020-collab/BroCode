import { useSyncExternalStore } from 'react';
import type { GuideGoal } from '../../core/ai/actions';
import type { VoiceLangId } from '../../core/ai/voice';

/**
 * The guide's one piece of shared state.
 *
 * It lives OUTSIDE React because the highlight must survive the surface that started it: a learner
 * opens the footer dock, asks to be guided to a course, and the Dashboard card that also hosts an
 * assistant unmounts the moment the route changes. The request therefore belongs to the shell, not
 * to one assistant instance, and `GuideLayer` (mounted once in `App.tsx`) renders it.
 *
 * `say` is the assistant's own voice function, handed over at start time so the guide speaks with
 * the same language and speed as the tutor instead of opening a second, competing synthesiser.
 */
export interface GuideRequest {
  goal: GuideGoal;
  lang: VoiceLangId;
  say: (text: string) => void;
}

let current: GuideRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function startGuide(request: GuideRequest) {
  current = request;
  emit();
}

export function stopGuide() {
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useGuideRequest(): GuideRequest | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** Is a guide running? Read outside React by the tutor, which must not narrate over it. */
export function guideActive(): boolean {
  return current !== null;
}
