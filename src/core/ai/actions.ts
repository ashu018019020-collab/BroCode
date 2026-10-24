/**
 * Guided actions — the stable bridge between what the tutor SAYS and the control that is actually on
 * screen.
 *
 * The rule this module exists to enforce: the tutor may never invent a button name or a coordinate.
 * A control lends the guide one stable attribute (`data-agent-action="…"`) and, optionally, its real
 * label (`data-agent-label="…"`); the guide reads the label back from the live element before it
 * speaks. If the element is not on the page, the guide says so and offers a way out instead of
 * pointing at nothing.
 *
 * Everything here is pure — a route string, course facts and a DOM snapshot go in, a step or a
 * verdict comes out — so the whole policy is testable without a browser. The DOM half lives in
 * `components/shared/GuideLayer.tsx` and does nothing but measure, render and report.
 *
 * The guide HIGHLIGHTS, it never clicks. The default mode is teacher-guided: the learner stays in
 * control, which is also why every step has a cancel and a skip.
 */
import type { VoiceLangId } from './voice';

/** The one attribute name. Written by the real controls, read only here. */
export const AGENT_ACTION_ATTR = 'data-agent-action';
/** Optional authored label, for a control whose textContent is not its name (a whole card). */
export const AGENT_LABEL_ATTR = 'data-agent-label';

/* --------------------------------- the ids -------------------------------- */

export function navActionId(route: string): string {
  return `nav:${route}`;
}

export function courseActionId(slug: string): string {
  return `course:${slug}`;
}

export function continueActionId(slug: string): string {
  return `course:continue:${slug}`;
}

export function stepActionId(slug: string, step: number): string {
  return `course:step:${slug}:${step}`;
}

/** `[data-agent-action="course:python-core"]`, with the value escaped for the CSS string grammar. */
export function actionSelector(id: string): string {
  const escaped = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\]/g, '\\]');
  return `[${AGENT_ACTION_ATTR}="${escaped}"]`;
}

/* ------------------------------- the planner ------------------------------ */

export type GuideGoal = 'start-course';

export interface GuideCourse {
  slug: string;
  name: string;
  /** Measured mastery of the course's sections, or null when it has no honest denominator. */
  pct: number | null;
}

export interface GuideStep {
  /** The stable id the highlighted control carries. */
  id: string;
  kind: 'nav' | 'course' | 'continue';
  /** What to do, in the learner's chosen language. Never quotes a label it has not read. */
  instruction: string;
  /** Why this is the next thing to do — always a real measured fact. */
  reason: string;
  /**
   * How completion is recognised. `prefix` is used where the destination carries a query
   * (`?tab=lesson`) or a step number the guide does not need to predict.
   */
  target: { path: string; mode: 'exact' | 'prefix' };
}

export type GuidePlan =
  | { kind: 'step'; step: GuideStep }
  | { kind: 'loading' }
  | { kind: 'done'; message: string }
  /** The path is blocked by something the guide cannot highlight (today: the account gate). */
  | { kind: 'stopped'; message: string };

const cleanRoute = (route: string): string => route.split('?')[0].split('#')[0];

/** The signed-out door. An account is required to learn — the guide points at it instead of a wall. */
export const AUTH_SIGN_IN_ACTION = 'auth:sign-in';

const signInStep = (lang: VoiceLangId): GuideStep => ({
  id: AUTH_SIGN_IN_ACTION,
  kind: 'nav',
  instruction: lang === 'hi-IN'
    ? 'Pehle sign in karo — main wahi control highlight kar raha hoon.'
    : 'First sign in — I am highlighting that control.',
  reason: lang === 'hi-IN'
    ? 'BroCode mein seekhne ke liye account zaroori hai.'
    : 'Learning in BroCode needs an account.',
  target: { path: '/login', mode: 'exact' },
});

const guideSignIn = (lang: VoiceLangId): string => (lang === 'hi-IN'
  ? 'Yeh page sign-in maangta hai. Form bhar ke sign in karo, phir "Guide me" dobara dabao — main wahin se aage badhunga.'
  : 'This page is the sign-in form. Sign in, then press Guide me again and I will continue from there.');

/** The open course surfaces. `/courses` is the list, `/course/:slug[/:no]` is one course. */
function onCourseSurface(route: string): boolean {
  return route === '/courses' || route.startsWith('/courses/') || route.startsWith('/course/');
}

const pctText = (pct: number | null, hi: boolean): string => {
  if (pct === null) return hi ? 'is course ke liye abhi koi measured percentage nahi hai' : 'this course has no measured percentage yet';
  return hi ? `${Math.round(pct)}% complete` : `${Math.round(pct)}% complete`;
};

/**
 * The next real control for the "get me started in a course" goal.
 *
 * Three states, all from facts: not on the course surface → open Courses; on the list → open the
 * first course that still has work (the list order is the authored roadmap order); on a course →
 * its next-step control. Deeper than that, the learner is already inside the lesson and the guide
 * says it is finished instead of pointing at a control it cannot vouch for.
 */
export function guidePlan(
  route: string,
  courses: GuideCourse[],
  lang: VoiceLangId,
  /** `undefined` means "auth is still loading" — do not gate on a guess. */
  signedIn?: boolean,
): GuidePlan {
  const hi = lang === 'hi-IN';
  const path = cleanRoute(route);

  if (signedIn === false) {
    if (path === '/login' || path === '/reset-password') return { kind: 'stopped', message: guideSignIn(lang) };
    return { kind: 'step', step: signInStep(lang) };
  }

  if (!onCourseSurface(path)) {
    return {
      kind: 'step',
      step: {
        id: navActionId('/courses'),
        kind: 'nav',
        instruction: hi
          ? 'Pehle Courses kholo — main navigation mein wahi control highlight kar raha hoon.'
          : 'First open Courses — I am highlighting that control in the navigation.',
        reason: hi ? 'Course list se hi aage ka rasta shuru hota hai.' : 'The course list is where the path starts.',
        target: { path: '/courses', mode: 'exact' },
      },
    } as const;
  }

  if (path === '/courses' || path === '/courses/') {
    if (!courses.length) return { kind: 'loading' };
    // A finished course is not "next": keep looking, and only fall back to the first card for review.
    const next = courses.find((course) => course.pct === null || course.pct < 100) ?? courses[0];
    return {
      kind: 'step',
      step: {
        id: courseActionId(next.slug),
        kind: 'course',
        instruction: hi
          ? `${next.name} course kholo — usi card par click karo.`
          : `Open the ${next.name} course — press its card.`,
        reason: `${pctText(next.pct, hi)}.`,
        target: { path: `/course/${next.slug}`, mode: 'prefix' },
      },
    };
  }

  const courseOnly = path.match(/^\/course\/([^/]+)\/?$/);
  if (courseOnly) {
    const slug = courseOnly[1];
    const course = courses.find((item) => item.slug === slug);
    if (!course) return { kind: 'loading' };
    return {
      kind: 'step',
      step: {
        id: continueActionId(slug),
        kind: 'continue',
        instruction: hi
          ? `Ab is course ka agla-step button dabao — mujhe uska asli naam screen se mil raha hai.`
          : 'Now press this course’s next-step button — I read its real name from the screen.',
        reason: `${course.name} · ${pctText(course.pct, hi)}.`,
        // The button carries `?tab=lesson`, and the step number is the course's choice, not ours.
        target: { path: `/course/${slug}/`, mode: 'prefix' },
      },
    };
  }

  return { kind: 'done', message: guideCompletion(lang) };
}

/* ------------------------------ verification ------------------------------ */

export type GuideStatus = 'waiting' | 'done' | 'missing' | 'blocked';

export interface GuideSnapshot {
  route: string;
  /** Does the registered control exist in the DOM right now? */
  present: boolean;
  /** Is it visibly unavailable (disabled / aria-disabled)? */
  disabled?: boolean;
}

/**
 * Did the learner's action actually happen?
 *
 * Completion is the ROUTE, not a click: a click that is swallowed by a validation error or an
 * overlay must not be reported as success. `blocked` beats `missing` so a disabled button gets the
 * honest explanation (the prerequisite is missing) instead of "I cannot find it".
 */
export function verifyGuide(step: GuideStep, snapshot: GuideSnapshot): GuideStatus {
  const path = cleanRoute(snapshot.route);
  const reached = step.target.mode === 'exact'
    ? path === step.target.path
    : path.startsWith(step.target.path);
  if (reached) return 'done';
  if (snapshot.disabled) return 'blocked';
  if (!snapshot.present) return 'missing';
  return 'waiting';
}

/* -------------------------------- recovery -------------------------------- */

/** What to say when the highlight has nothing to sit on. Actionable, never a dead end. */
export function guideRecovery(step: GuideStep, lang: VoiceLangId): string {
  const hi = lang === 'hi-IN';
  switch (step.kind) {
    case 'nav':
      return hi
        ? 'Navigation mein woh control nahi mil raha — shayad sidebar collapsed hai. Sidebar kholo, ya "Close guide" dabao aur main ruk jaata hoon.'
        : 'I cannot find that control in the navigation — the sidebar may be collapsed. Open it, or press Close guide and I will stop.';
    case 'course':
      return hi
        ? 'Yeh course card abhi screen par nahi mila. Courses page par wapas jao, ya Close guide dabao.'
        : 'That course card is not on screen right now. Go back to Courses, or press Close guide.';
    case 'continue':
      return hi
        ? 'Is course ka agla-step control nahi mila. Page reload karke dobara try karo, ya Close guide dabao.'
        : 'I cannot find this course’s next-step control. Reload the page and try again, or press Close guide.';
    default:
      return hi ? 'Yeh control abhi nahi mil raha.' : 'That control is not available right now.';
  }
}

/** The one line the guide ends on. It never claims the lesson was completed — only reached. */
export function guideCompletion(lang: VoiceLangId): string {
  return lang === 'hi-IN'
    ? 'Tum course ke andar pahunch gaye — guide yahin khatam hota hai. Aage lesson ke tabs khud explore karo.'
    : 'You are inside the course now — the guide stops here. Explore the lesson tabs from here.';
}

/** The status chip's wording. Kept here so the overlay cannot invent a fifth state. */
export function guideStatusLabel(status: GuideStatus, lang: VoiceLangId): string {
  const hi = lang === 'hi-IN';
  switch (status) {
    case 'done': return hi ? 'Ho gaya ✓' : 'Done ✓';
    case 'missing': return hi ? 'Nahi mila' : 'Not found';
    case 'blocked': return hi ? 'Abhi disabled' : 'Disabled';
    default: return hi ? 'Tumhare action ka wait' : 'Waiting for you';
  }
}

/**
 * Where the app wires each action family. A test greps `src/` for these markers, so an attribute
 * that is removed or renamed fails the suite instead of producing a guide that highlights nothing.
 */
export const AGENT_ACTION_WIRING = [
  { owner: 'src/app/App.tsx', marker: 'data-agent-action={`nav:${n.to}`}' },
  { owner: 'src/app/App.tsx', marker: 'data-agent-action="ai:open"' },
  { owner: 'src/app/App.tsx', marker: 'data-agent-action={AUTH_SIGN_IN_ACTION}' },
  { owner: 'src/features/dashboard/Landing.tsx', marker: 'data-agent-action={AUTH_SIGN_IN_ACTION}' },
  { owner: 'src/features/courses/CoursePage.tsx', marker: 'data-agent-action={`course:continue:${course.slug}`}' },
  { owner: 'src/features/practice/PracticeHub.tsx', marker: 'data-agent-action={`nav:practice`}' },
  { owner: 'src/features/practice/QuestionBank.tsx', marker: 'data-agent-action={`qb:section:${sectionId}`}' },
  { owner: 'src/features/practice/CoursePage.tsx', marker: 'data-agent-action={`course:continue:${course.slug}`}' },
  { owner: 'src/features/labs/LabsHub.tsx', marker: 'data-agent-action={`nav:labs`}' },
  { owner: 'src/features/labs/LabsHub.tsx', marker: 'data-agent-action={`lab:${route}`}' },
] as const;

/** The footer AI control, the tutor's own door. Registered for the same reason as the rest. */
export const AI_OPEN_ACTION = 'ai:open';
