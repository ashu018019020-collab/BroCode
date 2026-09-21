import { useSyncExternalStore } from 'react';
import type { AppState } from '../types';

const KEY = 'aiml:state:v1';

export const defaultState = (): AppState => ({
  version: 1,
  profile: { name: 'Ahetesham', goal: 'AI Engineer / GenAI / Agentic AI', level: 'Beginner', dailyMinutes: 60, onboarded: false },
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
});

function sanitize(s: AppState): AppState {
  if (typeof s.xp !== 'number' || !isFinite(s.xp)) s.xp = 0;
  for (const k of ['mistakes', 'bookmarks'] as const) if (!Array.isArray(s[k])) s[k] = [];
  for (const k of ['attempts', 'review', 'interviewAnswers', 'defenseAnswers', 'savedCode', 'activity'] as const) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  if (!s.profile || typeof s.profile !== 'object') s.profile = defaultState().profile;
  return s;
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
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

export function setState(patch: (s: AppState) => AppState) {
  state = patch(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota — keep in-memory */ }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useStore(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---- helpers ----
export const today = () => new Date().toISOString().slice(0, 10);

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
  for (const k of ['attempts', 'review', 'interviewAnswers', 'defenseAnswers', 'savedCode', 'activity']) if (!clean[k] || typeof clean[k] !== 'object') clean[k] = {};
  if (!clean.profile || typeof clean.profile !== 'object') clean.profile = defaultState().profile;
  setState(() => clean);
}
