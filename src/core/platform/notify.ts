/**
 * Notification centre — every entry is DERIVED from real learner state
 * (review schedule, mistakes, streak, mastery, XP milestones). Nothing here is
 * hardcoded or invented: if there is nothing worth saying, the list is empty.
 */
import type { AppState, AppNotification, Section } from '../../types';
import { dueReview, openMistakes } from '../learning/review';
import { sectionProgress, isMastered, currentSection } from '../learning/progress';
import { levelForXp } from './keys';
import { today } from '../learning/study';

/** Stable id so a notification keeps its read/unread state across sessions. */
const id = (kind: string, key: string) => `n:${kind}:${key}`;

const dayAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export function buildNotifications(state: AppState, sections: Section[]): AppNotification[] {
  const out: AppNotification[] = [];
  const byId = new Map(sections.map((s) => [s.id, s]));

  // 1. Spaced-repetition reviews that are actually due.
  const due = dueReview(state);
  if (due.length) {
    const first = byId.get(due[0].id);
    out.push({
      id: id('review', String(due.length)),
      kind: 'review',
      title: `${due.length} review${due.length > 1 ? 's' : ''} due`,
      body: first ? `Spaced repetition: review "${first.title}" first.` : 'The spaced-repetition queue is ready.',
      to: '/review',
    });
  }

  // 2. Mistakes that have repeated — a weak topic worth flagging.
  const open = openMistakes(state);
  const repeated = open.filter((m) => m.attempts >= 2);
  if (repeated.length) {
    const worst = repeated.reduce((a, b) => (b.attempts > a.attempts ? b : a));
    out.push({
      id: id('weak', worst.topic),
      kind: 'warning',
      title: `Weak topic: ${worst.topic}`,
      body: `Missed ${worst.attempts} times — do targeted practice.`,
      to: '/mistakes',
    });
  } else if (open.length) {
    out.push({
      id: id('open-mistakes', String(open.length)),
      kind: 'info',
      title: `${open.length} open mistake${open.length > 1 ? 's' : ''}`,
      body: 'Review them in the Mistake Tracker and mark them fixed.',
      to: '/mistakes',
    });
  }

  // 3. Streak reminder — only when today's activity has not happened yet.
  const t = today();
  if (!state.activity[t]) {
    out.push({
      id: id('streak', t),
      kind: 'streak',
      title: "Today's mission is still pending",
      body: state.streak.current > 0
        ? `Keep your ${state.streak.current}-day streak alive — complete one task.`
        : 'Complete one small task to start a streak.',
      to: '/',
    });
  }

  // 4. Achievements actually earned (derived from state, never pre-seeded).
  const mastered = sections.filter((s) => isMastered(s, state));
  if (mastered.length) {
    out.push({
      id: id('achievement', String(mastered.length)),
      kind: 'achievement',
      title: `${mastered.length} section${mastered.length > 1 ? 's' : ''} mastered`,
      body: `Most recent: "${mastered[mastered.length - 1].title}". Well done!`,
      to: '/progress',
    });
  }
  const level = levelForXp(state.xp);
  if (level >= 2) {
    out.push({
      id: id('level', String(level)),
      kind: 'success',
      title: `Reached Level ${level}`,
      body: `${state.xp} XP — stay consistent to reach the next level.`,
      to: '/progress',
    });
  }

  // 5. Anything in the last 3 days that was reviewed (recency signal).
  const recent = Object.entries(state.review)
    .filter(([, r]) => r.last >= dayAgo(3))
    .slice(0, 1);
  for (const [sid] of recent) {
    const s = byId.get(sid);
    if (s) out.push({ id: id('reviewed', sid), kind: 'success', title: `Reviewed: ${s.title}`, body: 'Recap done — keep going.', to: `/lesson/${sid}/learn` });
  }

  // 6. Next unfinished step in the frontier section (a real "what's next" nudge).
  const cur = currentSection(sections, state);
  const p = sectionProgress(cur, state);
  if (!isMastered(cur, state)) {
    out.push({
      id: id('next', `${cur.id}:${p.masterPct}`),
      kind: 'info',
      title: `Next: ${cur.title}`,
      body: `${p.masterPct}% complete — open the next step and keep going.`,
      to: `/lesson/${cur.id}/learn`,
    });
  }

  return out;
}

export const unreadCount = (list: AppNotification[], read: string[]) =>
  list.filter((n) => !read.includes(n.id)).length;
