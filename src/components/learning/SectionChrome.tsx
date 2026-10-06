import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, BarChart3, BookMarked, BookOpen, Bot, Brain, Bug, CheckSquare,
  Code2, FileText, Flame, FolderGit2, Mic2, Moon, Package, Play, Repeat, Settings as SettingsIcon,
  Shield, Sparkles, StickyNote, Target, Trophy, Zap,
} from 'lucide-react';
import { STAGES, STAGE_META, stageTagline, type Stage, type Tone } from '../../core/learning/progress';
import { useStore } from '../../core/storage/store';
import { useUi, setUi } from '../../core/storage/ui';
import { ProgressRing } from '../ui/ui';

/** Any icon-shaped component (lucide or a local wrapper) rendered at a given size. */
export type IconCmp = ComponentType<{ size?: string | number }>;

/** One icon per stage — the grid is scanned visually, so emoji won't do. */
export const STAGE_ICON: Record<Stage, IconCmp> = {
  learn: BookOpen, interview: Mic2, coding: Code2, logic: Brain, debug: Bug,
  solved: CheckSquare, mini: Package, project: FolderGit2, defense: Shield, checkpoint: Trophy,
};

export interface HeroStat {
  n: ReactNode;
  l: string;
  tone: Tone;
  Icon: IconCmp;
  /** Tiles that open something are links; the rest are plain read-only tiles. */
  to?: string;
  /** One line explaining what the number counts, when the label alone cannot. */
  hint?: string;
}

/**
 * The top of a lesson: where you came from, which section this is, how far you
 * are, and what is actually inside it. Every number is a real count from this
 * section's own content — nothing here is decorative.
 */
export function SectionHero({
  no, title, subtitle, pct, minutes, status, stats, backLabel, onBack, glyph: Glyph,
}: {
  no: string;
  title: string;
  subtitle: string;
  pct: number;
  minutes: number;
  status: 'done' | 'progress' | 'new';
  stats: HeroStat[];
  backLabel: string;
  onBack: () => void;
  glyph: IconCmp;
}) {
  const statusText =
    status === 'done' ? 'Completed' : status === 'progress' ? 'In Progress' : 'Not started';
  const statusTone =
    status === 'done' ? 'var(--green)' : status === 'progress' ? 'var(--cyan)' : 'var(--muted)';

  return (
    <section className="hero-wrap fadeup">
      <button className="back-tile" onClick={onBack} aria-label={`Back to ${backLabel}`}>
        <span className="arrow"><ArrowLeft size={15} /></span>
        <span>
          <b>Back to course</b>
          <span>{backLabel}</span>
        </span>
      </button>

      <div className="card hero-main glow-border">
        <div className="row" style={{ gap: 14 }}>
          <span className="hero-glyph" style={{ ['--accent' as string]: 'var(--blue)', ['--accent-rgb' as string]: '59 130 246' }}>
            <Glyph size={22} />
          </span>
          <div>
            <span className="chip" style={{ marginBottom: 4 }}>SECTION {no}</span>
            <h1 style={{ margin: '2px 0 2px' }}>{title}</h1>
            <p className="muted small" style={{ margin: 0 }}>{subtitle}</p>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <span className="status-chip" style={{ ['--accent' as string]: statusTone }}>
                <i /> {statusText}
              </span>
              <span className="chip">⏱ ~{minutes} min</span>
            </div>
          </div>
        </div>
        <ProgressRing pct={pct} size={92} label={`Mastery ${pct}%`} />
      </div>

      <div className="hero-stats">
        {stats.map((s) => {
          const inner = (
            <>
              <span className="ic"><s.Icon size={17} /></span>
              <span>
                <span className="n">{s.n}</span>
                <span className="l">{s.l}</span>
              </span>
            </>
          );
          // `hint` exists because a number can be right and still need one line of explanation:
          // a stage's own questions are not in its panel count, so the tiles do not add up to the
          // section total. Saying so beats letting a learner distrust both numbers.
          return s.to
            ? <Link key={s.l} className={`stat-tile tone-${s.tone}`} to={s.to} title={s.hint}>{inner}</Link>
            : <div key={s.l} className={`stat-tile tone-${s.tone}`} title={s.hint}>{inner}</div>;
        })}
      </div>
    </section>
  );
}

/**
 * The stage rail: numbered, colour-coded, and honest about state.
 * A stage is only marked done when its real completion gate is satisfied; a
 * stage ahead of the current one is dimmed but never disabled.
 */
export function StageGrid({
  active, isDone, pctOf, onPick, isApplicable, countOf,
}: {
  active: Stage;
  isDone: (st: Stage) => boolean;
  pctOf: (st: Stage) => number;
  onPick: (st: Stage) => void;
  /** A stage this section has no content for (no debug task, no checkpoint bank). */
  isApplicable?: (st: Stage) => boolean;
  /**
   * How many questions this stage holds for this section, or null when it holds none.
   * Shown as a badge so "how much can I practise here" is answerable from the rail itself,
   * instead of only after opening every stage.
   */
  countOf?: (st: Stage) => number | null;
}) {
  const activeIdx = STAGES.indexOf(active);
  return (
    <div className="stage-grid">
      {STAGES.map((st, i) => {
        const na = isApplicable ? !isApplicable(st) : false;
        const done = !na && isDone(st);
        const current = st === active;
        const ahead = !na && !done && !current && i > activeIdx;
        const pct = na ? 0 : Math.max(0, Math.min(100, Math.round(pctOf(st))));
        // Kept independent of `na`: a stage can be outside this topic's mastery gates and still
        // hold plenty of practice questions, and hiding the count there reads as "no content".
        const count = countOf ? countOf(st) : null;
        const Icon = STAGE_ICON[st];
        const state = na
          ? count ? `${count} Q&A practice — mastery gate nahi` : 'not applicable to this topic'
          : done ? 'completed' : current ? 'current stage' : `${pct}%`;
        return (
          <button
            key={st}
            className={`stage-tile tone-${STAGE_META[st].tone} ${done ? 'done' : ''} ${current ? 'current' : ''} ${ahead ? 'ahead' : ''} ${na ? 'na' : ''}`}
            onClick={() => onPick(st)}
            title={na && !count ? 'Is topic me yeh stage nahi hai' : STAGE_META[st].blurb}
            aria-current={current ? 'step' : undefined}
            aria-label={`${STAGE_META[st].label} — ${state}`}
          >
            <span className="no">{String(i + 1).padStart(2, '0')}</span>
            {done && <span className="st-check">✓</span>}
            {na && <span className="st-na">n/a</span>}
            <span className="glyph"><Icon size={17} /></span>
            <b>{STAGE_META[st].label}</b>
            <span className="sub">{stageTagline(st)}</span>
            {count != null && count > 0 && (
            <span className="chip" style={{ marginTop: 6 }} title={`${count} questions is stage ke Q&A panel me — stage ke apne questions uske andar alag count hote hain`}>
              {count} Q&A
            </span>
          )}
            <span className="mini-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
          </button>
        );
      })}
    </div>
  );
}

/** Small always-available tool row — the same destinations as the sidebar, one tap away. */
export function UtilityStrip() {
  const ui = useUi();
  const tools: { to: string; Icon: IconCmp; label: string; sub: string; tone: Tone }[] = [
    { to: '/notes', Icon: StickyNote, label: 'Notes', sub: 'Write & Organize', tone: 'amber' },
    { to: '/cheat-sheets', Icon: BookMarked, label: 'Resources', sub: 'Code, Docs, Links', tone: 'violet' },
    { to: '/playground', Icon: Sparkles, label: 'AI Tutor', sub: 'Explain, Hint, Debug', tone: 'cyan' },
    { to: '/progress', Icon: BarChart3, label: 'Progress', sub: 'Detailed Analytics', tone: 'green' },
    { to: '/job-prep', Icon: Target, label: 'Goals', sub: 'Set & Track', tone: 'fuchsia' },
    { to: '/review', Icon: Repeat, label: 'Review', sub: 'Spaced Repetition', tone: 'blue' },
    { to: '/settings', Icon: SettingsIcon, label: 'Settings', sub: 'Customize', tone: 'purple' },
  ];
  return (
    <div className="utility-strip fadeup">
      {tools.map((tool) => (
        <Link key={tool.to} className={`util-tile tone-${tool.tone}`} to={tool.to}>
          <span className="ic"><tool.Icon size={15} /></span>
          <span><b>{tool.label}</b><span>{tool.sub}</span></span>
        </Link>
      ))}
      <span className="util-sep" />
      <button
        className="util-tile tone-cyan"
        onClick={() => setUi({ focus: !ui.focus })}
        aria-pressed={ui.focus}
        title="Focus Mode — sidebar aur chrome chhupa do"
      >
        <span className="ic"><Moon size={15} /></span>
        <span><b>Focus Mode</b><span>Distraction Free</span></span>
        <span className={`switch ${ui.focus ? 'on' : ''}`}><i /></span>
      </button>
      <span className="util-sep" />
      <Link className="util-tile tone-gold" to="/exam">
        <span className="ic"><Flame size={15} /></span>
        <span><b>Timed Test</b><span>Exam Mode</span></span>
      </Link>
    </div>
  );
}

/**
 * The coach row: what to do next, how today is going, and which mistakes still
 * belong to THIS section. All three read real learner state.
 */
export function LessonCoach({
  sectionId, sectionTitle, nba, onStart,
}: {
  sectionId: string;
  sectionTitle: string;
  nba: { label: string; reason: string; route: string };
  onStart: (route: string) => void;
}) {
  const state = useStore();

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayXp = state.activity[todayKey] ?? 0;
  // One finished task ≈ 25 XP in this app's economy, so this is a real count.
  const todayTasks = Math.min(3, Math.floor(todayXp / 25));
  const goal = 3;

  const mine = state.mistakes.filter((m) => m.section === sectionId || m.section.includes(sectionId));
  const open = mine.filter((m) => !m.fixed);
  const byType = new Map<string, number>();
  for (const m of open) byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
  const rows = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div className="coach-grid">
      <div className="card coach-card tone-blue">
        <div className="row spread">
          <h2 className="row" style={{ gap: 8, margin: 0 }}><Zap size={16} color="var(--blue)" /> Next Best Action</h2>
          <span className="chip">{sectionTitle}</span>
        </div>
        <p className="small" style={{ margin: '8px 0 4px' }}><b>{nba.label}</b></p>
        <p className="muted small" style={{ margin: 0 }}>{nba.reason}</p>
        <button className="btn primary" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }} onClick={() => onStart(nba.route)}>
          <ArrowRight size={14} /> Continue
        </button>
      </div>

      <div className="card coach-card tone-cyan">
        <div className="row spread">
          <h2 className="row" style={{ gap: 8, margin: 0 }}><Target size={16} color="var(--cyan)" /> Today's Goal</h2>
          <span className="chip">{todayTasks}/{goal} tasks</span>
        </div>
        <p className="muted small" style={{ margin: '8px 0 6px' }}>
          {todayTasks >= goal ? 'Aaj ka target pura — consistency hi asli edge hai. 🔥' : 'Stay consistent! 💪'}
        </p>
        <div className="bar"><div style={{ width: `${Math.round((todayTasks / goal) * 100)}%` }} /></div>
        <div className="row small muted" style={{ marginTop: 8, gap: 10 }}>
          <span><Flame size={12} style={{ verticalAlign: -2 }} /> {state.streak.current} day streak</span>
          <span>{todayXp} XP today</span>
        </div>
      </div>

      <div className="card coach-card tone-red">
        <div className="row spread">
          <h2 className="row" style={{ gap: 8, margin: 0 }}><Bug size={16} color="var(--red)" /> Mistakes to Review</h2>
          <span className="count-pill" style={{ background: open.length ? 'var(--red)' : 'var(--panel2)' }}>{open.length}</span>
        </div>
        {!rows.length && (
          <p className="muted small" style={{ margin: '10px 0 0' }}>
            Is section me koi open mistake nahi — jo aayegi wahi yahan dikhegi.
          </p>
        )}
        {rows.map(([type, n]) => (
          <div key={type} className="row spread small" style={{ padding: '5px 0' }}>
            <span style={{ textTransform: 'capitalize' }}>{type}</span>
            <span className="muted">{n} {n === 1 ? 'time' : 'times'}</span>
          </div>
        ))}
        {open.length > 0 && (
          <button className="btn small" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={() => onStart('/mistakes')}>
            Review now <ArrowRight size={12} />
          </button>
        )}
      </div>

      <div className="card coach-card tone-cyan">
        <div className="row spread">
          <h2 className="row" style={{ gap: 8, margin: 0 }}><Bot size={16} color="var(--cyan)" /> AI Assistant</h2>
          <span className="chip easy">● Ready</span>
        </div>
        <p className="muted small" style={{ margin: '8px 0 6px' }}>Tutor: explain, hint, debug — bundled curriculum se.</p>
        <button className="btn small" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onStart('/playground')}>
          <Play size={12} /> Open tutor
        </button>
      </div>
    </div>
  );
}

/** Page-level "where am I" strip used by section-independent pages. */
export function BackChip({ label, to }: { label: string; to: string }) {
  return (
    <Link className="back-tile" to={to}>
      <span className="arrow"><ArrowLeft size={15} /></span>
      <span><b>Back</b><span>{label}</span></span>
    </Link>
  );
}

/**
 * The pillar breadcrumb: the hub this page belongs to, then the page's own name.
 *
 * Every surface a pillar hub indexes wears one, so a learner who arrived from a search result, a
 * notebook deep link or the browser's back button can always walk up to the hub that owns the
 * page. The four pillars (Practice, Labs, Interview, Career) share this so their crumbs cannot
 * drift into four different shapes, and the layout test reads it to prove the wiring is intact.
 */
export function HubCrumb({ hub, hubLabel, page }: { hub: string; hubLabel: string; page: string }) {
  return (
    <div className="row small muted" style={{ gap: 6, marginBottom: 6 }}>
      <Link to={hub} className="row" style={{ gap: 4 }}><ArrowLeft size={13} /> {hubLabel}</Link>
      <span>›</span><span className="chip">{page}</span>
    </div>
  );
}

export const HERO_ICONS = { BookOpen, FileText, Shield, Trophy, FolderGit2 };
