import type { AppState, Section } from '../../types';
import { PAGES } from '../platform/search';
import { currentSection, sectionProgress } from '../learning/progress';
import type { KnowledgeIndex } from './knowledge';
import type { AssistantContext } from './assistant';

const stageNames: Record<string, string> = {
  learn: 'Lesson', interview: 'Interview practice', coding: 'Coding lab', debug: 'Debug lab',
  logic: 'Logic lab', solved: 'Solved examples', mini: 'Mini project', project: 'Project lab',
  checkpoint: 'Checkpoint', defense: 'Project defense', practice: 'Practice',
};

export function assistantContextForPage(
  pathname: string,
  search: string,
  sections: Section[],
  state: AppState,
  index?: KnowledgeIndex | null,
): AssistantContext {
  const params = new URLSearchParams(search);
  const lessonMatch = pathname.match(/^\/lesson\/([^/]+)\/([^/]+)/);
  const questionSection = params.get('section');
  const sectionId = lessonMatch?.[1] ?? questionSection ?? undefined;
  const section = sectionId ? sections.find((item) => item.id === sectionId) : undefined;
  const stage = lessonMatch?.[2];
  const courseRoute = pathname.match(/^\/course\/([^/]+)(?:\/(\d+))?/);
  const trackRoute = pathname.match(/^\/track\/([^/]+)/);
  const track = trackRoute ? index?.trackRoutes.find((item) => item.slug === trackRoute[1]) : undefined;
  const course = courseRoute
    ? index?.courses.find((item) => item.slug === courseRoute[1])
    : sectionId
      ? index?.courses.find((item) => item.sections[sectionId] !== undefined)
      : track?.course
        ? index?.courses.find((item) => item.slug === track.course)
        : undefined;
  const courseStep = courseRoute?.[2]
    ? course?.steps.find((step) => step.number === Number(courseRoute[2]))
    : undefined;
  const page = PAGES.find((item) => item.route === pathname);

  let pageTitle = page?.title ?? '';
  if (section) pageTitle = section.title;
  else if (courseStep) pageTitle = courseStep.title;
  else if (course) pageTitle = course.title;
  else if (track) pageTitle = track.title;
  else if (pathname.startsWith('/lesson/')) pageTitle = 'Lesson';

  const where = [
    course?.title ?? track?.title,
    section?.title ?? pageTitle,
    stage ? stageNames[stage] ?? stage : '',
    questionSection && params.get('type') ? `Question Bank · ${params.get('type')}` : '',
  ].filter(Boolean).join(' · ');
  const courseSections = course
    ? Object.keys(course.sections).map((id) => sections.find((item) => item.id === id)).filter((item): item is Section => !!item)
    : [];
  const frontier = !section && !courseSections.length && sections.length ? currentSection(sections, state) : undefined;
  const progressSections = section ? [section] : courseSections.length ? courseSections : frontier ? [frontier] : [];
  const progressSummary = progressSections.length
    ? `${frontier ? `Current frontier: ${frontier.title} · ` : ''}${Math.round(progressSections.reduce((sum, item) => sum + sectionProgress(item, state).masterPct, 0) / progressSections.length)}% mastery across ${progressSections.length} section${progressSections.length === 1 ? '' : 's'} · ` +
      `${state.mistakes.filter((item) => !item.fixed && progressSections.some((candidate) => candidate.id === item.section)).length} open mistakes`
    : undefined;

  return {
    route: `${pathname}${search}`,
    pageTitle: pageTitle || undefined,
    sectionId,
    where: where || undefined,
    courseSlug: course?.slug,
    courseTitle: course?.title ?? track?.title,
    chapterTitle: courseStep?.title,
    lessonTitle: section?.title,
    topic: params.get('topic') ?? undefined,
    questionType: params.get('type') ?? undefined,
    learningLevel: state.profile.level,
    learningGoal: state.profile.goal,
    progressSummary,
  };
}
