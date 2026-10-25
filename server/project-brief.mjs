/**
 * The BroCode project brief — what the voice agent is told about THIS platform.
 *
 * WHY THIS EXISTS
 *
 * A realtime model with no project context answers "what can I learn here?" with a generic list of
 * topics, and "which section covers decorators?" with a guess. BroCode already ships its curriculum
 * as generated JSON, so the honest fix is to describe the real thing to the model: the actual
 * section numbers and titles, the stages every section has, and the parts of the app that exist.
 *
 * The brief is DERIVED, never authored: every title in it is read from
 * `public/generated/curriculum/sections.json` (itself generated from `content/`, the source of
 * truth). Nothing is invented, so the model cannot "remember" a section that is not there — and the
 * instructions tell it to say so when a topic is missing instead of inventing one.
 *
 * Failure is silent by design: a missing or unreadable file yields an empty brief, the session is
 * minted without project context, and online voice still works. Offline behaviour is untouched
 * because this module is only read by the Node API.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(HERE, '..', 'public', 'generated', 'curriculum', 'sections.json');

/** The brief is a prompt, not a document: beyond this it costs tokens without adding grounding. */
export const PROJECT_BRIEF_LIMIT = 1500;

/** The stages each section ships, in the order a learner meets them. */
export const SECTION_STAGES = ['learn', 'interview', 'code', 'logic', 'solved', 'mini', 'project', 'checkpoint'];

/** The parts of the app the voice may point at. Real routes/areas, not marketing claims. */
export const APP_AREAS = [
  'Courses (the curriculum, section by section)',
  'Practice (question bank)',
  'Labs / Playground (in-browser code editor with the project’s own runner)',
  'Projects (project labs and builds)',
  'Interview (mock interviews and reports)',
  'Career and Progress',
  'Notes, Cheat Sheets and PDF Reader',
  'AI Mentor (this conversation)',
];

/**
 * The curriculum as a compact sentence: "29 sections — 1. Variables & Data Types; 2. Operators; …".
 *
 * Titles only, bounded by `limit`. A section without a usable title is skipped rather than printed
 * as "undefined", and the total still names the real count so the model cannot inflate it.
 */
export function summarizeCurriculum(sections, { limit = PROJECT_BRIEF_LIMIT } = {}) {
  const list = Array.isArray(sections) ? sections : [];
  const named = list
    .filter((section) => section && typeof section.title === 'string' && section.title.trim())
    .map((section) => ({
      no: Number.isFinite(Number(section.no)) ? Number(section.no) : null,
      title: section.title.trim(),
    }));
  if (!named.length) return '';

  const head = `The curriculum has ${named.length} sections: `;
  const parts = [];
  let length = head.length;
  for (const section of named) {
    const entry = section.no === null ? section.title : `${section.no}. ${section.title}`;
    if (length + entry.length + 2 > limit) {
      parts.push('…');
      break;
    }
    parts.push(entry);
    length += entry.length + 2;
  }
  return `${head}${parts.join('; ')}.`;
}

/**
 * The full brief. Pure: the file contents are passed in, so the wording is testable without a
 * filesystem and the caller decides where the curriculum lives.
 */
export function buildProjectBrief(raw, { limit = PROJECT_BRIEF_LIMIT } = {}) {
  let sections = [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    sections = Array.isArray(parsed) ? parsed : (parsed?.sections ?? []);
  } catch {
    return '';
  }
  const curriculum = summarizeCurriculum(sections, { limit });
  if (!curriculum) return '';

  return [
    'BroCode is a Python-to-AI-Engineer learning platform: courses, hands-on practice, a code',
    'playground, project labs and mock interviews, in English and Hinglish.',
    curriculum,
    `Every section has the same stages: ${SECTION_STAGES.join(', ')}.`,
    `The app has these areas: ${APP_AREAS.join('; ')}.`,
    'When asked about BroCode, use only these real names and numbers.',
  ].join(' ');
}

/**
 * Read the brief once, on first use, straight from the generated curriculum.
 *
 * Cached because a realtime session is minted far more often than the curriculum changes, and
 * reading a file per session would put disk latency in front of a paid API call. Any failure —
 * no file, bad JSON, a read-only deployment — returns '' so the caller simply has no brief.
 */
let cached;
export function projectBrief(file = DEFAULT_FILE) {
  if (cached !== undefined) return cached;
  try {
    cached = buildProjectBrief(readFileSync(file, 'utf8'));
  } catch {
    cached = '';
  }
  return cached;
}

/** Tests only: forget the cached file so a fixture can be re-read. */
export function resetProjectBriefCache() {
  cached = undefined;
}
