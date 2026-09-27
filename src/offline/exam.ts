/**
 * Persisted exam session (localStorage) — a running timed paper must survive a
 * reload, an accidental tab close, or a crash. React subscribes through
 * useSyncExternalStore so the timer, the question counter and the shell badge
 * all read the same session object.
 *
 * The session is deliberately self-contained: it stores the selected questions
 * WITH their answers, so grading still works even if a bank file changes or a
 * section is reopened later. Only the learner's own data lives here.
 */
import { useSyncExternalStore } from 'react';
import {
  EXAM_VERSION, DEFAULT_BLUEPRINT, makeSeed, remainingMs,
  type ExamBlueprint, type ExamQuestion, type ExamSession,
} from '../engine/exam';

const KEY = 'aiml:exam:v1';
const DEFAULT_BLUEPRINT_FALLBACK: ExamBlueprint = DEFAULT_BLUEPRINT;

function sanitize(s: ExamSession): ExamSession {
  if (!Array.isArray(s.questions)) s.questions = [];
  if (!s.answers || typeof s.answers !== 'object') s.answers = {};
  if (!s.grades || typeof s.grades !== 'object') s.grades = {};
  if (!Array.isArray(s.flags)) s.flags = [];
  if (!['running', 'grading', 'done'].includes(s.phase)) s.phase = 'running';
  if (typeof s.index !== 'number' || s.index < 0 || s.index >= s.questions.length) s.index = 0;
  if (!s.blueprint || typeof s.blueprint !== 'object') s.blueprint = DEFAULT_BLUEPRINT_FALLBACK;
  const minutes = typeof s.blueprint.minutes === 'number' && s.blueprint.minutes > 0 ? s.blueprint.minutes : 10;
  if (typeof s.startedAt !== 'number' || !isFinite(s.startedAt)) s.startedAt = Date.now();
  if (typeof s.endsAt !== 'number' || !isFinite(s.endsAt)) s.endsAt = s.startedAt + minutes * 60000;
  if (typeof s.seed !== 'number') s.seed = 0;
  return s;
}

function load(): ExamSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.questions)) return null;
    return sanitize(parsed as ExamSession);
  } catch {
    return null;
  }
}

let session: ExamSession | null = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch { /* quota — keep in memory */ }
}

function emit() { persist(); for (const l of listeners) l(); }

export function getExam(): ExamSession | null { return session; }

export function setExam(next: ExamSession | null) {
  session = next;
  emit();
}

/** Functional patch on the live session; a no-op when there is none. */
export function updateExam(fn: (s: ExamSession) => ExamSession) {
  if (!session) return;
  session = sanitize(fn(session));
  emit();
}

export function useExam(): ExamSession | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => session,
    () => session,
  );
}

/* --------------------------------- actions -------------------------------- */

export function startExam(bp: ExamBlueprint, questions: ExamQuestion[], seed = makeSeed()): ExamSession {
  const startedAt = Date.now();
  const next: ExamSession = {
    version: EXAM_VERSION,
    id: `ex${startedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    seed,
    blueprint: bp,
    questions,
    startedAt,
    endsAt: startedAt + bp.minutes * 60000,
    answers: {},
    flags: [],
    grades: {},
    index: 0,
    phase: 'running',
  };
  setExam(next);
  return next;
}

/** Rebuild the same paper from the SAME seed, clock reset — a fair retake. */
export function retakeExam(questions: ExamQuestion[]) {
  const cur = session;
  if (!cur) return;
  startExam(cur.blueprint, questions, cur.seed);
}

export function setAnswer(questionId: string, value: string) {
  updateExam((s) => ({ ...s, answers: { ...s.answers, [questionId]: value } }));
}

export function toggleFlag(questionId: string) {
  updateExam((s) => ({
    ...s,
    flags: s.flags.includes(questionId) ? s.flags.filter((f) => f !== questionId) : [...s.flags, questionId],
  }));
}

export function gotoIndex(i: number) {
  updateExam((s) => ({ ...s, index: Math.max(0, Math.min(s.questions.length - 1, i)) }));
}

export function gradeQuestion(questionId: string, correct: boolean | undefined) {
  updateExam((s) => {
    const grades = { ...s.grades };
    if (correct === undefined) delete grades[questionId];
    else grades[questionId] = correct;
    return { ...s, grades };
  });
}

/** Move to the self-grading phase. `timedOut` marks a clock-forced submission. */
export function submitExam(timedOut = false) {
  updateExam((s) => (s.phase === 'running' ? { ...s, phase: 'grading', timedOut } : s));
}

export function markSaved(savedXp: number, savedMistakes: number) {
  updateExam((s) => ({ ...s, phase: 'done', savedAt: Date.now(), savedXp, savedMistakes }));
}

/** Seconds left on the live clock, refreshed on an interval by the page. */
export function clockLeft(): number {
  return session ? remainingMs(session) : 0;
}

export function clearExam() { setExam(null); }
