/**
 * Notification centre — every entry is DERIVED from real learner state
 * (review schedule, mistakes, streak, mastery, XP milestones). Nothing here is
 * hardcoded or invented: if there is nothing worth saying, the list is empty.
 *
 * The engine returns COPY KEYS, not English prose. It has no business knowing which language the
 * learner reads, and the bell panel lives inside a bilingual shell — every notification used to be
 * the one English-only surface in it. The ids are unchanged, so a notification marked read before
 * this change stays read.
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
      title: { key: 'notif.reviewsDue', vars: { n: due.length } },
      body: first
        ? { key: 'notif.reviewsFirst', vars: { title: first.title } }
        : { key: 'notif.reviewsReady' },
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
      title: { key: 'notif.weakTopic', vars: { topic: worst.topic } },
      body: { key: 'notif.weakBody', vars: { n: worst.attempts } },
      to: '/mistakes',
    });
  } else if (open.length) {
    out.push({
      id: id('open-mistakes', String(open.length)),
      kind: 'info',
      title: { key: 'notif.openMistakes', vars: { n: open.length } },
      body: { key: 'notif.openMistakesBody' },
      to: '/mistakes',
    });
  }

  // 3. Streak reminder — only when today's activity has not happened yet.
  const t = today();
  if (!state.activity[t]) {
    out.push({
      id: id('streak', t),
      kind: 'streak',
      title: { key: 'notif.streakPending' },
      body: state.streak.current > 0
        ? { key: 'notif.streakKeep', vars: { n: state.streak.current } }
        : { key: 'notif.streakStart' },
      to: '/',
    });
  }

  // 4. Achievements actually earned (derived from state, never pre-seeded).
  const mastered = sections.filter((s) => isMastered(s, state));
  if (mastered.length) {
    out.push({
      id: id('achievement', String(mastered.length)),
      kind: 'achievement',
      title: { key: 'notif.mastered', vars: { n: mastered.length } },
      body: { key: 'notif.masteredBody', vars: { title: mastered[mastered.length - 1].title } },
      to: '/progress',
    });
  }
  const level = levelForXp(state.xp);
  if (level >= 2) {
    out.push({
      id: id('level', String(level)),
      kind: 'success',
      title: { key: 'notif.level', vars: { level } },
      body: { key: 'notif.levelBody', vars: { xp: state.xp } },
      to: '/progress',
    });
  }

  // 5. Anything in the last 3 days that was reviewed (recency signal).
  const recent = Object.entries(state.review)
    .filter(([, r]) => r.last >= dayAgo(3))
    .slice(0, 1);
  for (const [sid] of recent) {
    const s = byId.get(sid);
    if (s) {
      out.push({
        id: id('reviewed', sid),
        kind: 'success',
        title: { key: 'notif.reviewed', vars: { title: s.title } },
        body: { key: 'notif.reviewedBody' },
        to: `/lesson/${sid}/learn`,
      });
    }
  }

  // With no curriculum loaded there is no frontier to name: `currentSection([])` is `undefined`
  // and `sectionProgress(undefined)` throws, so an empty curriculum must end the list here.
  if (!sections.length) return out;

  // 6. Next unfinished step in the frontier section (a real "what's next" nudge).
  const cur = currentSection(sections, state);
  const p = sectionProgress(cur, state);
  if (!isMastered(cur, state)) {
    out.push({
      id: id('next', `${cur.id}:${p.masterPct}`),
      kind: 'info',
      title: { key: 'notif.next', vars: { title: cur.title } },
      body: { key: 'notif.nextBody', vars: { pct: p.masterPct } },
      to: `/lesson/${cur.id}/learn`,
    });
  }

  return out;
}

export const unreadCount = (list: AppNotification[], read: string[]) =>
  list.filter((n) => !read.includes(n.id)).length;
