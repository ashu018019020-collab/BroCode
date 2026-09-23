import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Map as MapIcon, List, ChevronRight, Target, BarChart3, Lightbulb, CalendarCheck, Compass,
} from 'lucide-react';
import { useCurriculum } from '../data/curriculum';
import { useTrackIndex } from '../data/tracks';
import { useStore } from '../offline/store';
import { sectionProgress, currentSection } from '../engine/progress';
import { Bar, ProgressRing } from '../components/ui';
import { useI18n } from '../i18n';
import { TRACK_DEFS } from '../App';
import type { LocaleKey } from '../i18n/locales';

/**
 * Learning Path — all 8 tracks are ALWAYS open.
 * Prerequisites are recommendations (guidance), never locks: no card is
 * disabled, no CTA is blocked, no dependency-based hiding.
 */
export default function LearningPath() {
  const { sections } = useCurriculum();
  const trackIndex = useTrackIndex();
  const state = useStore();
  const { t } = useI18n();
  const nav = useNavigate();
  const [view, setView] = useState<'roadmap' | 'list'>('roadmap');

  /** Progress per track from REAL section mastery (guidance only, no gating). */
  const pctOf = useMemo(() => {
    const fn = (key: string) => {
      const def = TRACK_DEFS.find((d) => d.id === key)!;
      const secs = sections.filter((s) => s.no >= def.from && s.no <= def.to);
      if (!secs.length) return 0;
      return Math.round(secs.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / secs.length);
    };
    return fn;
  }, [sections, state]);

  const cur = currentSection(sections, state);
  const curPct = sectionProgress(cur, state).masterPct;
  const overall = Math.round(sections.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, sections.length));

  const weak = useMemo(() => {
    const counts = new Map<string, { topic: string; n: number; fixed: number }>();
    for (const m of state.mistakes) {
      const e = counts.get(m.topic) ?? { topic: m.topic, n: 0, fixed: 0 };
      e.n += 1;
      if (m.fixed) e.fixed += 1;
      counts.set(m.topic, e);
    }
    return [...counts.values()].filter((e) => e.n >= 1).sort((a, b) => b.n - a.n).slice(0, 5);
  }, [state.mistakes]);

  const weeklyDone = useMemo(() => {
    let acts = 0;
    for (let i = 0; i < 7; i++) acts += Math.floor((state.activity[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] ?? 0) / 25);
    return Math.min(5, acts);
  }, [state.activity]);

  const firstOpenTask = useMemo(() => {
    const m = { min: Infinity, sid: cur.id, stage: 'learn' };
    for (const s of sections) {
      if (s.no > cur.no) break;
      for (const stage of ['learn', 'interview', 'coding', 'logic', 'debug', 'mini']) {
        const anyPending = !state.attempts[`st:${s.id}:${stage}`] && !state.attempts[`view:${s.id}:${stage === 'learn' ? 'learn' : stage}`];
        if (anyPending && s.no < m.min) { m.min = s.no; m.sid = s.id; m.stage = stage; }
      }
    }
    return m;
  }, [sections, state.attempts, cur]);

  const slugOf = (key: string) => {
    const def = TRACK_DEFS.find((d) => d.id === key);
    if (!def) return null;
    const nameKey = String(def.nameKey);           // e.g. "track.python"
    const title = t(def.nameKey as LocaleKey);     // e.g. "Python Core"
    // index.json slugs mirror TRACK_SLUGS; fall back to title-derived match
    const byTitle = trackIndex?.find((x) => x.title === title);
    if (byTitle) return byTitle.slug;
    const SLUGS: Record<string, string> = {
      python: 'python-core', data: 'numpy-pandas', sql: 'sql', ml: 'ml-nlp',
      genai: 'genai', agentic: 'agentic-ai', apis: 'apis-production', interview: 'interview-projects',
    };
    return SLUGS[key] ?? null;
  };

  const trackRows = TRACK_DEFS.map((def, i) => {
    const secs = sections.filter((s) => s.no >= def.from && s.no <= def.to);
    const pct = pctOf(def.id);
    const slug = slugOf(def.id);
    const idxEntry = slug ? trackIndex?.find((x) => x.slug === slug) : undefined;
    const recs = (def.prereq ?? []).filter((p) => pctOf(p) < 60); // informational only
    return { def, i, pct, slug, chapters: idxEntry?.chapters ?? (def.to - def.from + 1), recs };
  });

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><MapIcon size={24} color="var(--cyan)" /> AI ENGINEER ROADMAP</h1>
          <p className="muted small" style={{ maxWidth: 640 }}>{t('path.subtitle')}</p>
          <div className="row small muted" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <span className="chip">8 Learning Tracks</span>
            <span className="chip">{overall}% {t('dash.overall')}</span>
            <span className="chip">Skills: Python · Data · SQL · ML · NLP · GenAI · Agents · Backend · Production · Interview</span>
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="chip">⭐ {t('top.level')} — {state.xp} XP</span>
          <span className="chip easy">✓ All tracks open</span>
        </div>
      </div>

      <div className="row" style={{ margin: '14px 0' }}>
        <div className="lang-toggle">
          <button className={view === 'roadmap' ? 'on' : ''} onClick={() => setView('roadmap')}><MapIcon size={14} style={{ verticalAlign: -2 }} /> {t('path.viewRoadmap')}</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={14} style={{ verticalAlign: -2 }} /> {t('path.viewList')}</button>
        </div>
      </div>

      <div className="path-grid">
        <div>
          {view === 'roadmap' ? (
            <div className="track-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
              {trackRows.map(({ def, i, pct, slug, chapters, recs }) => {
                const Icon = def.icon;
                const status = pct >= 100 ? 'complete' : pct > 0 ? 'progress' : 'available';
                return (
                  <div key={def.id} className="track-card">
                    <span className="num">{String(i + 1).padStart(2, '0')}</span>
                    <div className="head">
                      <span className="ic" style={{ color: def.color }}><Icon size={21} /></span>
                      <h3>{t(def.nameKey as LocaleKey)}</h3>
                      <span className="ringwrap"><ProgressRing pct={pct} size={46} /></span>
                    </div>
                    <p className="desc">{def.desc}</p>
                    <div className="meta"><span>⏱ ~{def.hours} {t('track.hours')}</span><span>{chapters} Chapters</span></div>
                    <Bar pct={pct} />
                    {recs.length > 0 ? (
                      <div className="prereq ok">
                        <Compass size={12} /> Recommended: {recs.map((m) => t(TRACK_DEFS.find((d) => d.id === m)!.nameKey as LocaleKey)).join(', ')} (60%+)
                      </div>
                    ) : (
                      <div className="prereq ok"><span className="small muted">✓ {t('track.noPrereq')}</span></div>
                    )}
                    <div className="actions">
                      <button className="btn small primary" onClick={() => slug && nav(`/track/${slug}`)}>
                        Explore Track <ChevronRight size={13} />
                      </button>
                      <Link className="btn small" to={`/lesson/${firstTrackLesson(def, sections)}/coding`}>{t('track.practiceBtn')}</Link>
                    </div>
                    {status === 'complete' && <span className="chip easy" style={{ position: 'absolute', top: 12, right: 12 }}>✓</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tablewrap card">
              <table className="data">
                <thead><tr><th>Track</th><th>Progress</th><th>Hours</th><th>Recommended Before</th><th></th></tr></thead>
                <tbody>
                  {trackRows.map(({ def, i, pct, slug, chapters, recs }) => (
                    <tr key={def.id}>
                      <td><b>{String(i + 1).padStart(2, '0')} — {t(def.nameKey as LocaleKey)}</b><div className="small muted">{chapters} chapters</div></td>
                      <td style={{ minWidth: 120 }}><Bar pct={pct} /></td>
                      <td>~{def.hours}h</td>
                      <td className="small muted">{recs.length ? recs.map((m) => t(TRACK_DEFS.find((d) => d.id === m)!.nameKey as LocaleKey)).join(', ') + ' (60%+)' : '—'}</td>
                      <td><button className="btn small" onClick={() => slug && nav(`/track/${slug}`)}>Explore Track</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="goalbar" style={{ marginTop: 16 }}>
            {[t('dash.stage1'), t('dash.stage2'), t('dash.stage3'), t('dash.stage4')].map((l, i) => (
              <div key={l} className={`stage ${overall >= [0, 25, 50, 80][i] ? 'on' : ''}`}>
                <span className="stepnum">{i + 1}</span><div className="lbl"><b>{l}</b></div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div className="path-rail">
          <div className="card">
            <div className="row spread"><h3 className="row" style={{ gap: 8, margin: 0 }}><Target size={16} color="var(--pink)" /> {t('path.mission')}</h3><span className="chip">Day {Math.max(1, state.streak.current)}</span></div>
            <p className="small" style={{ margin: '8px 0 4px' }}><b>Read: {cur.title}</b></p>
            <p className="muted small">{t('path.missionDesc')}</p>
            <Bar pct={curPct} />
            <Link className="btn small primary" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }} to={`/lesson/${cur.id}/learn`}>
              {t('path.openLesson')} <ChevronRight size={13} />
            </Link>
          </div>

          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><BarChart3 size={16} color="var(--red)" /> {t('path.weak')}</h3>
            {!weak.length && <p className="muted small" style={{ marginTop: 8 }}>{t('path.weakNone')}</p>}
            {weak.map((w) => (
              <div key={w.topic} className="row spread small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{w.topic}</span>
                <span className="muted small">{w.fixed >= w.n ? '✓' : w.n >= 2 ? t('path.weakPractice') : t('path.weakEmpty')}</span>
              </div>
            ))}
            <Link className="small" to="/mistakes" style={{ display: 'inline-block', marginTop: 8 }}>{t('dash.viewAll')} →</Link>
          </div>

          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><Lightbulb size={16} color="var(--amber)" /> {t('path.recommended')}</h3>
            <div className="stat" style={{ marginTop: 8 }}>
              <b className="small">{cur.title}</b>
              <div className="row small muted" style={{ marginTop: 4 }}><span>~20 min</span><span className="chip">Beginner</span></div>
            </div>
            <Link className="btn small" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} to={`/lesson/${firstOpenTask.sid}/${firstOpenTask.stage}`}>{t('dash.continue')} →</Link>
          </div>

          <div className="card">
            <div className="row spread"><h3 className="row" style={{ gap: 8, margin: 0 }}><CalendarCheck size={16} color="var(--cyan)" /> {t('path.weeklyGoal')}</h3><span className="small">{weeklyDone}/5</span></div>
            <p className="muted small" style={{ marginTop: 4 }}>{t('path.weeklySub')}</p>
            <Bar pct={(weeklyDone / 5) * 100} />
          </div>

          <div className="card" style={{ borderLeft: '3px solid var(--violet)' }}>
            <p className="small" style={{ margin: 0, fontStyle: 'italic' }}>{t('path.quote')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** First section of a track, for the quick Practice CTA. */
function firstTrackLesson(def: (typeof TRACK_DEFS)[number], sections: ReturnType<typeof useCurriculum>['sections']): string {
  const secs = sections.filter((s) => s.no >= def.from && s.no <= def.to);
  return secs[0]?.id ?? 's01';
}
