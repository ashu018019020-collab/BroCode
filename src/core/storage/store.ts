import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppState, Note } from '../../types';
import type { ExamWriteEntry } from '../assessment/exam';
import { bankAttempt } from '../platform/keys';
import { addStudy, today } from '../learning/study';
import { accountStorageKey, subscribeStorageAccount } from './account';

const KEY = 'aiml:state:v1';

export const defaultState = (): AppState => ({
  version: 1,
  profile: { name: 'Ahetesham', goal: 'Programming & Software Development', level: 'Beginner', dailyMinutes: 60, onboarded: false },
  xp: 0,
  streak: { current: 0, last: '' },
  attempts: {},
  bookmarks: [],
  mistakes: [],
  review: {},
  interviewAnswers: {},
  defenseAnswers: {},
  savedCode: {},
  settings: { reduceMotion: false },
  activity: {},
  study: {},
  notes: [],
  jobPrep: {},
  readNotifs: [],
});

function sanitize(s: AppState): AppState {
  if (typeof s.xp !== 'number' || !isFinite(s.xp)) s.xp = 0;
  for (const k of ['mistakes', 'bookmarks'] as const) if (!Array.isArray(s[k])) s[k] = [];
  for (const k of ['attempts', 'review', 'interviewAnswers', 'defenseAnswers', 'savedCode', 'activity', 'study', 'jobPrep'] as const) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  if (!Array.isArray(s.notes)) s.notes = [];
  if (!Array.isArray(s.readNotifs)) s.readNotifs = [];
  if (!s.profile || typeof s.profile !== 'object') s.profile = defaultState().profile;
  // One-time rename: the old goal named ROLES ("AI Engineer / GenAI / Agentic AI"); the profile
  // now carries a FIELD OF STUDY (Onboarding/Settings' pickers). Existing states migrate so no
  // chip keeps printing the retired string.
  if (s.profile.goal === 'AI Engineer / GenAI / Agentic AI') s.profile.goal = 'Programming & Software Development';
  return s;
}

function load(key = accountStorageKey(KEY)): AppState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return sanitize({ ...defaultState(), ...parsed });
  } catch {
    return defaultState();
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function getState(): AppState { return state; }

subscribeStorageAccount(() => {
  state = load();
  listeners.forEach((listener) => listener());
});

export function setState(patch: (s: AppState) => AppState) {
  state = patch(state);
  try { localStorage.setItem(accountStorageKey(KEY), JSON.stringify(state)); } catch { /* quota — keep in-memory */ }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useStore(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/**
 * Read the current state outside React. Async flows (running a whole notebook cell by cell)
 * must check what is REALLY stored right now instead of the snapshot their render captured,
 * otherwise the first cell's write would look like it never happened. Read-only: writes still
 * go through setState/recordAttempt/addXp.
 */
export function stateSnapshot(): AppState {
  return state;
}

// ---- helpers ----
/**
 * Today's key, re-exported from the engine rather than being a second copy of the same rule.
 *
 * XP, the streak and study time all bucket by this string. Two implementations of 'YYYY-MM-DD'
 * (one local, one UTC) is exactly how a dashboard ends up showing tonight's streak next to a hole
 * in tonight's study — so the format has one owner, `engine/study.ts`, and everything else asks it.
 * Pages keep importing it from here; an ENGINE must import it from `engine/study.ts` directly, or
 * the pure layer ends up importing the store back.
 */
export { today };

/**
 * Add measured study time to a day (`key` defaults to today).
 *
 * Called by the session tracker on a slow timer — tens of seconds, never per second. `setState`
 * serialises the WHOLE state and writes localStorage synchronously, so a per-second tick would cost
 * a full `JSON.stringify` every second for a number nobody is looking at until this page opens.
 * A refused amount (bad key, zero, negative) costs no write at all.
 */
export function addStudySeconds(seconds: number, key = today()) {
  const before = stateSnapshot().study ?? {};
  const study = addStudy(before, seconds, key);
  if (study === before) return;
  setState((s) => ({ ...s, study }));
}

/**
 * Store the profile photo.
 *
 * A data URL, and only ever a small one: the caller `Progress.tsx` draws the picked image onto a
 * 128×128 canvas first, because the original file would be re-serialised on every single store
 * write (a phone photo would turn this state into megabytes).
 */
export function setAvatar(dataUrl: string) {
  setState((s) => ({ ...s, profile: { ...s.profile, avatar: dataUrl } }));
}

export function addXp(n: number, type?: string, label?: string) {
  setState((s) => ({
    ...s,
    xp: s.xp + n,
    activity: { ...s.activity, [today()]: (s.activity[today()] ?? 0) + n },
  }));
}

export function recordAttempt(key: string, attempt: Partial<AppState['attempts'][string]>) {
  setState((s) => ({
    ...s,
    attempts: { ...s.attempts, [key]: { ...s.attempts[key], ...attempt, ts: Date.now() } },
  }));
}

// ---- written answers -------------------------------------------------------
/**
 * The single place a WRITTEN answer lives.
 *
 * Every surface that asks the learner to type something — the question bank, the per-stage Q&A
 * panel, the logic and debug drills, the final paper — stores its text in the same field of the
 * same attempt record, `Attempt.answer`. That field already existed (the exam wrote it through
 * `applyExamWrites`), so nothing new was invented and no stored progress needed migrating: an
 * answer written before this helper existed still reads back.
 *
 * The reason it is a helper instead of an inline write: typing used to be local component state,
 * so a refresh threw the answer away, and the mistake tracker had nothing to record and fell back
 * to placeholders like "(self-grade: galat)". One reader and one writer means a question answered
 * in the lesson is answered in the bank too.
 */
export function savedAnswer(state: AppState, key: string): string {
  return state.attempts[key]?.answer ?? '';
}

/**
 * Persist a written answer WITHOUT touching the grade. Setting `done` here would be a lie about
 * the learner's skill — typing an answer is not passing — so `saveAnswer` never moves a gate.
 */
export function saveAnswer(key: string, text: string) {
  recordAttempt(key, { answer: text });
}

/**
 * A controlled answer field backed by the store.
 *
 * Saves on a 400 ms debounce: the whole state is one JSON blob in localStorage, so writing on
 * every keystroke (as the interview box did) is wasteful, but waiting for a submit is worse —
 * a refresh or a closed tab mid-sentence used to lose the answer outright. The pending write is
 * flushed when the field's key changes (next question / next item) and when it unmounts.
 */
export function useSavedAnswer(key: string): [string, (value: string) => void] {
  const state = useStore();
  const stored = savedAnswer(state, key);
  const [local, setLocal] = useState(stored);
  const timer = useRef<number | undefined>(undefined);
  const scheduled = useRef<{ key: string; value: string } | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== undefined) { window.clearTimeout(timer.current); timer.current = undefined; }
    const pending = scheduled.current;
    scheduled.current = null;
    if (pending && pending.value !== (stateSnapshot().attempts[pending.key]?.answer ?? '')) {
      saveAnswer(pending.key, pending.value);
    }
  }, []);

  // A new key means a new field: commit the old one, then show what is stored for the new one.
  // Deliberately keyed on `key` alone — re-running on every store change would overwrite the
  // text the learner is still typing with the last debounced value.
  useEffect(() => {
    flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setLocal(stateSnapshot().attempts[key]?.answer ?? '');
  }, [key, flush]);

  useEffect(() => () => flush(), [flush]);

  const set = useCallback((value: string) => {
    setLocal(value);
    scheduled.current = { key, value };
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  }, [key, flush]);

  return [local, set];
}

export function bumpStreak() {
  const t = today();
  const s = getState();
  if (s.streak.last === t) return;
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const current = s.streak.last === y ? s.streak.current + 1 : 1;
  setState((st) => ({ ...st, streak: { current, last: t } }));
}

export function addMistake(m: Omit<AppState['mistakes'][number], 'id' | 'date' | 'attempts' | 'fixed'>) {
  setState((s) => ({
    ...s,
    mistakes: [{ ...m, id: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, date: today(), attempts: 1, fixed: false }, ...s.mistakes].slice(0, 200),
  }));
}

/**
 * File a finished exam in ONE atomic write: attempts, mistakes, review resets,
 * XP and activity all land together, so a paper can never be half-saved (which
 * would otherwise inflate XP or lose wrong answers if the tab closed mid-loop).
 *
 * Nothing about a question the learner left UNGRADED reaches this function —
 * the caller filters those out, so an ungraded question can never be recorded
 * as wrong.
 */
export function applyExamWrites(entries: ExamWriteEntry[], xp: number) {
  if (!entries.length) return;
  const now = Date.now();
  setState((s) => {
    const attempts = { ...s.attempts };
    const review = { ...s.review };
    const fresh: AppState['mistakes'] = [];
    const stamp = new Date(now).toISOString();

    entries.forEach((e, i) => {
      // Through the key owner, not a hand-typed "qb:" string — a typo here would file every
      // graded exam answer under a key nothing else can read.
      const key = bankAttempt(e.questionId);
      attempts[key] = { ...(attempts[key] ?? {}), done: e.correct, tries: e.tries, answer: e.answer, ts: now };
      if (e.reviewReset) review[e.sectionId] = { level: 0, last: stamp };
      if (e.mistake) {
        fresh.push({ ...e.mistake, id: `m${now}${i}`, date: today(), attempts: 1, fixed: false });
      }
    });

    return {
      ...s,
      attempts,
      review,
      mistakes: [...fresh, ...s.mistakes].slice(0, 200),
      xp: s.xp + xp,
      activity: xp > 0 ? { ...s.activity, [today()]: (s.activity[today()] ?? 0) + xp } : s.activity,
    };
  });
}

// ---- notes ----
export const newNote = (partial: Partial<Note> = {}): Note => ({
  id: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  title: '', body: '', tags: [], fav: false,
  created: Date.now(), updated: Date.now(),
  ...partial,
});

export function upsertNote(note: Note) {
  setState((s) => {
    const exists = s.notes.some((n) => n.id === note.id);
    const next = { ...note, updated: Date.now() };
    return { ...s, notes: exists ? s.notes.map((n) => (n.id === note.id ? next : n)) : [next, ...s.notes] };
  });
}

export function deleteNote(id: string) {
  setState((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }));
}

export function toggleNoteFav(id: string) {
  setState((s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, fav: !n.fav, updated: Date.now() } : n)) }));
}

// ---- job-prep checklist ----
export function toggleJobPrep(id: string) {
  setState((s) => ({ ...s, jobPrep: { ...s.jobPrep, [id]: !s.jobPrep[id] } }));
}

// ---- notifications ----
export function markNotifsRead(ids: string[]) {
  setState((s) => ({ ...s, readNotifs: [...new Set([...s.readNotifs, ...ids])].slice(-300) }));
}

export function clearNotifs() {
  setState((s) => ({ ...s, readNotifs: [] }));
}

export function exportProgress() {
  const blob = new Blob([JSON.stringify(getState())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `ai-master-lab-progress-${today()}.json`; a.click();
  URL.revokeObjectURL(url);
}

export async function importProgress(file: File) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.attempts !== 'object' || parsed.attempts === null) throw new Error('Not a valid progress file (attempts missing)');
  const clean: any = { ...defaultState(), ...parsed };
  if (typeof clean.xp !== 'number' || !isFinite(clean.xp)) clean.xp = 0;
  for (const k of ['mistakes', 'bookmarks']) if (!Array.isArray(clean[k])) clean[k] = [];
  for (const k of ['attempts', 'review', 'interviewAnswers', 'defenseAnswers', 'savedCode', 'activity', 'study']) if (!clean[k] || typeof clean[k] !== 'object') clean[k] = {};
  if (!clean.profile || typeof clean.profile !== 'object') clean.profile = defaultState().profile;
  setState(() => clean);
}
