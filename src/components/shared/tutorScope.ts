import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { AssistantContext } from '../../core/ai/assistant';

/**
 * THE TUTOR'S SCOPE, OUTSIDE REACT.
 *
 * A step page and a Project Lab build already build a scoped tutor: the authored context, the four
 * starters and the briefing from `core/ai/step-tutor.ts`. But that block sits near the bottom of the
 * page, so a learner halfway up the step — or looking at a collapsed build card — had to scroll to
 * it before the tutor knew what they were reading.
 *
 * This store is the one place that scope is published from, and the footer dock (`AiDock`) reads it.
 * The context is therefore the SAME object the page block uses, not a second derivation: the dock
 * cannot name a different build or a different step than the page it hangs over.
 *
 * It lives outside React for the same reason `guideStore.ts` does — the scope belongs to the route,
 * not to one assistant instance, and a dock that opens after a re-render must still find it. The id
 * guard keeps an unmounting surface from clearing a newer surface's scope (step → build during a
 * route change).
 */
export interface TutorScopeInput {
  kind: 'step' | 'build';
  /** The step title or the build name, printed beside the entry's heading. */
  title: string;
  context: AssistantContext;
  prompts: string[];
  briefing: string;
}

export interface TutorScope extends TutorScopeInput {
  /** Identifies the publisher, so only it can clear what it published. */
  id: number;
}

let current: TutorScope | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The scope the current route published, or null on every other page. */
export function useTutorScope(): TutorScope | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

export function publishTutorScope(scope: TutorScopeInput): number {
  const id = ++seq;
  current = { ...scope, id };
  emit();
  return id;
}

export function clearTutorScope(id: number) {
  if (current?.id !== id) return;
  current = null;
  emit();
}

/**
 * The whole published payload, so the effect re-runs when the surface actually changes rather than
 * on every render (the pages rebuild their scope object each time).
 */
function signature(input: TutorScopeInput | null): string {
  if (!input) return '';
  return [
    input.kind,
    input.title,
    input.briefing,
    input.prompts.join('\u0000'),
    input.context.sectionId ?? '',
    input.context.route ?? '',
    input.context.where ?? '',
    input.context.topic ?? '',
  ].join('\u0001');
}

/** Publish this surface's scope for as long as it is mounted; `null` publishes nothing. */
export function usePublishTutorScope(input: TutorScopeInput | null) {
  const latest = useRef(input);
  latest.current = input;
  const sig = signature(input);
  useEffect(() => {
    if (!latest.current) return;
    const id = publishTutorScope(latest.current);
    return () => clearTutorScope(id);
  }, [sig]);
}
