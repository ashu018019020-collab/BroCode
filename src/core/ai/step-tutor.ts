/**
 * SCOPED TUTOR — what the learner has in front of them, said in the tutor's own terms.
 *
 * The offline assistant (`assistant.ts`) already answers from the bundled curriculum, and the card
 * already accepts a `context`. What was missing was the CONTEXT ITSELF on the two surfaces where a
 * learner most needs help — the current roadmap step (`/course/:slug/:n`) and the current build in
 * the Project Lab. Without it the card could only say what the route was called; with it the
 * assistant knows the step's authored goal and topics, or the build's files, architecture and
 * done-when, and can be asked about exactly that.
 *
 * Everything here comes from authored content passed in by the page. Nothing is generated, nothing
 * is fetched, and a field the curriculum left empty is omitted — never filled with a placeholder
 * that would read like a step the curriculum does not have. Pure: no React, no store.
 */
import type { AssistantContext } from './assistant';

/** One roadmap step, as the course page already knows it. */
export interface StepScope {
  no: number;
  title: string;
  courseTitle: string;
  /** The roadmap's authored goal for this step, when it has one. */
  goal?: string;
  /** The step's authored topics, in curriculum order. */
  topics?: string[];
  route: string;
}

/**
 * One Project Lab build — structurally the `ProjectBrief` the page renders, narrowed to the fields
 * the tutor needs. Kept structural so a change to the brief's UI-only fields cannot break the tutor.
 */
export interface BuildScope {
  name: string;
  sectionTitle: string;
  tier: string;
  what: string;
  files: string;
  architecture: string;
  buildTarget: string;
  edgeCases: string[];
  steps: { no: number; label: string; detail: string }[];
  defenseQuestion: string;
  route: string;
}

const clean = (value: string | undefined): string => String(value ?? '').replace(/\s+/g, ' ').trim();
const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** The assistant's context for a roadmap step. Empty fields are simply absent. */
export function stepTutorContext(scope: StepScope): AssistantContext {
  const title = clean(scope.title);
  const course = clean(scope.courseTitle);
  const topic = (scope.topics ?? []).map(clean).find(Boolean);
  return {
    pageTitle: title || `Step ${scope.no}`,
    chapterTitle: title || undefined,
    lessonTitle: title || undefined,
    courseTitle: course || undefined,
    topic,
    where: [`Step ${scope.no}`, course, title].filter(Boolean).join(' · '),
    route: scope.route,
  };
}

/** The assistant's context for a Project Lab build. */
export function buildTutorContext(scope: BuildScope): AssistantContext {
  const name = clean(scope.name);
  const section = clean(scope.sectionTitle);
  const tier = clean(scope.tier);
  return {
    pageTitle: name || 'Project build',
    lessonTitle: section || undefined,
    where: ['Build', section, tier, name].filter(Boolean).join(' · '),
    route: scope.route,
  };
}

/**
 * Starter questions for a step, derived only from the step's authored fields.
 *
 * These are the four things a learner actually asks on a step page — what is this, show me the
 * concept, when is it done, where do I start — phrased around the real title/topic so the
 * retrieval has something to match. A step with no authored goal or topic still gets the generic
 * four; it never gets a question naming a topic it does not teach.
 */
export function stepTutorPrompts(scope: StepScope): string[] {
  const title = clean(scope.title);
  const topic = (scope.topics ?? []).map(clean).find(Boolean);
  const goal = clean(scope.goal);
  return [
    title ? `What is "${clip(title, 70)}" asking me to do?` : 'What is this step asking me to do?',
    topic ? `Explain ${clip(topic, 60)} with an example.` : 'Explain the main idea of this step with an example.',
    goal ? `How do I know I have reached this goal: ${clip(goal, 90)}` : 'How do I know this step is finished?',
    'What should I open first in this step?',
  ];
}

/**
 * Starter questions for a build, from the brief's own material: the files it asks for, the edge
 * case it names, and the defense question it already carries. The last one IS the authored
 * question — asking the tutor to help answer it is the point of a defense.
 */
export function buildTutorPrompts(scope: BuildScope): string[] {
  const name = clean(scope.name);
  const files = clean(scope.files);
  const edge = (scope.edgeCases ?? []).map(clean).find(Boolean);
  const defense = clean(scope.defenseQuestion);
  return [
    name ? `Walk me through this build: ${clip(name, 70)}` : 'Walk me through this build.',
    files ? `What should ${clip(files, 60)} contain?` : 'What files should I create first?',
    edge ? `How do I test this case: ${clip(edge, 90)}` : 'How do I test this build before calling it done?',
    defense ? `${clip(defense, 110)}` : 'How would I defend this build in an interview?',
  ];
}

/**
 * A one-paragraph briefing from authored fields, shown above the prompts.
 *
 * It exists so the learner can see WHAT the tutor is being told — the same "no invented context"
 * rule the rest of the app follows. Every clause is optional; a page with nothing authored gets a
 * single honest line instead of an empty shell.
 */
export function stepBriefing(scope: StepScope): string {
  const title = clean(scope.title);
  const course = clean(scope.courseTitle);
  const goal = clean(scope.goal);
  const topics = (scope.topics ?? []).map(clean).filter(Boolean);
  const head = [`Step ${scope.no}`, course, title].filter(Boolean).join(' · ');
  const parts = [
    goal ? `Goal: ${clip(goal, 180)}` : '',
    topics.length ? `Topics: ${topics.map((t) => clip(t, 40)).join(', ')}` : '',
  ].filter(Boolean);
  return parts.length ? `${head}. ${parts.join(' · ')}` : `${head}. This page lists the step's own material.`;
}

export function buildBriefing(scope: BuildScope): string {
  const name = clean(scope.name);
  const section = clean(scope.sectionTitle);
  const tier = clean(scope.tier);
  const what = clean(scope.what);
  const files = clean(scope.files);
  const architecture = clean(scope.architecture);
  const target = clean(scope.buildTarget);
  const steps = scope.steps?.length ?? 0;
  const head = [name, tier, section].filter(Boolean).join(' · ');
  const parts = [
    what ? `What: ${clip(what, 220)}` : '',
    files ? `Files: ${clip(files, 80)}` : '',
    architecture ? `Architecture: ${clip(architecture, 140)}` : '',
    target ? `Done when: ${clip(target, 140)}` : '',
    steps ? `${steps} build steps` : '',
  ].filter(Boolean);
  return parts.length ? `${head}. ${parts.join(' · ')}` : `${head}. Open the build path for the authored material.`;
}
