import { useEffect, useMemo, useState } from 'react';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, FileText, Target, ArrowLeft, Compass, Lightbulb,
} from 'lucide-react';
import { useTrackDoc, type TrackDoc, type TrackChapter } from '../../core/data/tracks';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore } from '../../core/storage/store';
import { sectionProgress, nextBestAction } from '../../core/learning/progress';
import { itemAttempt } from '../../core/platform/keys';
import { TRACK_SLUG, trackHref, trackKeyOf } from '../../core/learning/surfaces';
import { Bar, ProgressRing } from '../../components/ui/ui';
import { TRACK_DEFS } from '../../app/App';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import type { Section } from '../../types';

/** Topic status derived ONLY from real attempt state — never invented. */
type TopicStatus = 'done' | 'current' | 'available' | 'review';

export default function TrackOverview() {
  const { trackSlug } = useParams();
  const doc = useTrackDoc(trackSlug);
  const { sections } = useCurriculum();
  const state = useStore();
  const nav = useNavigate();
  const { t } = useI18n();
  const [openCh, setOpenCh] = useState<string | null>(null);

  /**
   * Legacy `/track/<id>` URLs (python, data, ml, apis…) render forever: the route matches, but the
   * loader fetches a file that was never generated. Old sitemaps and any shared link that used the
   * short id are still floating around, so send them to the real page instead of a dead loader.
   */
  const legacySlug = trackSlug ? TRACK_SLUG[trackSlug] : undefined;
  useEffect(() => {
    if (legacySlug) nav(trackHref(trackSlug!), { replace: true });
  }, [legacySlug, trackSlug, nav]);

  const chapterPct = useMemo(() => {
    const map: Record<string, number> = {};
    if (!doc) return map;
    for (const ch of doc.chapters) {
      const sec = sections.find((s) => s.id === ch.id);
      map[ch.id] = sec ? sectionProgress(sec, state).masterPct : 0;
    }
    return map;
  }, [doc, sections, state]);

  if (!doc) return <div className="loading">{trackSlug ? 'Track load ho raha hai…' : 'Track not found.'}</div>;

  const def = TRACK_DEFS.find((d) => d.id === doc.key);
  const overall = doc.chapters.length
    ? Math.round(doc.chapters.reduce((a, ch) => a + (chapterPct[ch.id] ?? 0), 0) / doc.chapters.length)
    : 0;
  const totals = doc.chapters.reduce((a, ch) => ({
    concepts: a.concepts + ch.counts.concepts,
    interview: a.interview + ch.counts.interview,
    coding: a.coding + ch.counts.coding,
    projects: a.projects + ch.counts.projects,
    topics: a.topics + ch.topics.length,
  }), { concepts: 0, interview: 0, coding: 0, projects: 0, topics: 0 });

  // Non-blocking recommendation: prerequisite names + next best action of the first unfinished chapter.
  // `recommendedPrerequisites` hold real slugs ("numpy-pandas"); the id ↔ slug bridge lives in
  // surfaces.ts (TRACK_SLUG / trackKeyOf) so no page keeps its own copy of the mapping.
  const prereqTracks = doc.recommendedPrerequisites
    .flatMap((slug) => {
      const found = TRACK_DEFS.find((d) => d.id === trackKeyOf(slug));
      return found ? [{ slug, def: found }] : [];
    });
  const prereqNames = prereqTracks.map((x) => x.def.id);
  const prereqTitles = prereqTracks.map((x) => x.def.desc.split(',')[0]);
  const firstUnfinished = doc.chapters.find((ch) => (chapterPct[ch.id] ?? 0) < 100) ?? doc.chapters[0];
  const firstSec = sections.find((s) => s.id === firstUnfinished?.id);
  const nba = firstSec ? nextBestAction(firstSec, state) : null;

  /**
   * Related tracks — real internal links in BOTH directions. A track page was a leaf: it linked
   * down into its own lessons but nothing walked the learner onward, and a crawler saw a dead end.
   * `backLinks` are the tracks recommended before this one; `forwardLinks` are the ones whose own
   * prereq list names it — the learner's next step, and the crawler's way out. Both are `<Link>`s
   * and both spell the target with `trackHref`, and the label goes through i18n, so the id→slug
   * bridge can never leak a raw key like "track.ml" onto the screen.
   */
  const backLinks = prereqTracks.map((x) => ({ id: x.def.id, to: trackHref(x.def.id), label: t(x.def.nameKey as LocaleKey) }));
  // Forward: the tracks whose own prereq list names this one. Python is required by none — it is
  // where everybody starts — so an empty result falls back to the next track in roadmap order,
  // because a track page with no way onward is the dead end this card exists to close.
  const unlocks = TRACK_DEFS.filter((d) => (d.prereq ?? []).includes(doc.key));
  const nextInOrder = TRACK_DEFS.slice(TRACK_DEFS.findIndex((d) => d.id === doc.key) + 1, TRACK_DEFS.findIndex((d) => d.id === doc.key) + 2);
  const forwardDefs = unlocks.length > 0 ? unlocks : nextInOrder;
  const forwardLinks = forwardDefs.map((d) => ({ id: d.id, to: trackHref(d.id), label: t(d.nameKey as LocaleKey) }));

  const topicMark = (ch: TrackChapter, tp: { id: string }, sec: Section | undefined): TopicStatus => {
    if (!sec) return 'available';
    const i = ch.topics.findIndex((x) => x.id === tp.id);
    const done = !!state.attempts[itemAttempt(sec.id, 'learn', i)];
    const reviewed = (state.review[sec.id]?.level ?? 0) > 0;
    if (done && reviewed) return 'review';
    return done ? 'done' : 'available';
  };

  return (
    <div>
      {/* HEADER */}
      <div className="card glow fadeup" style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <HubCrumb hub="/courses" hubLabel="Courses" page={`TRACK ${String(doc.number).padStart(2, '0')}`} />
          <h1>{doc.title}</h1>
          <p className="muted small" style={{ maxWidth: 640 }}>{doc.description}</p>
          <div className="row small muted" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <span className="chip">{doc.chapters.length} Chapters</span>
            <span className="chip">{totals.topics} Topics</span>
            <span className="chip">{totals.concepts} Concepts</span>
            <span className="chip">{totals.coding} Coding</span>
            <span className="chip">{totals.interview} Interview</span>
            <span className="chip">{totals.projects} Projects</span>
            <span>⏱ ~{doc.estimatedHours}h</span>
          </div>
        </div>
        <ProgressRing pct={overall} size={72} label={`${overall}% overall`} />
      </div>

      {/* NON-BLOCKING RECOMMENDATION BANNER */}
      {prereqNames.length > 0 && (
        <div className="card fadeup" style={{ borderColor: 'rgba(56,189,248,.4)', marginTop: 12 }}>
          <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div className="small muted row" style={{ gap: 6 }}><Compass size={13} /> RECOMMENDED FOUNDATION (guidance, not a lock)</div>
              <b className="small">{prereqTitles.join(', ')} — recommended 60%+ pehle complete karna.</b>
              <p className="small muted" style={{ margin: '2px 0 0' }}>Recommended: NumPy basics clear hone se ye track easier hoga. Par explorer tum ho — kahin bhi jao.</p>
            </div>
            <div className="row">
              <Link className="btn small" to="/courses">View Recommended Tracks</Link>
              <span className="chip easy">✓ Available — Start Anyway</span>
            </div>
          </div>
        </div>
      )}

      {/* CURRICULUM TREE */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row spread">
          <h2 style={{ margin: 0 }}>📚 Complete Curriculum Index</h2>
          <span className="small muted">Chapter expand karo → topic kholo</span>
        </div>
        <div className="tree" role="tree" aria-label={`${doc.title} curriculum`}>
          {doc.chapters.map((ch) => {
            const open = openCh === ch.id;
            const pct = chapterPct[ch.id] ?? 0;
            const sec = sections.find((s) => s.id === ch.id);
            return (
              <div key={ch.id} className="tree-ch" role="treegroup" aria-expanded={open}>
                <button
                  className="tree-row ch"
                  onClick={() => setOpenCh(open ? null : ch.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenCh(open ? null : ch.id); } }}
                  aria-expanded={open}
                >
                  <span className="mark">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
                  <span className="num small muted">{String(ch.number).padStart(2, '0')}</span>
                  <b style={{ flex: 1, textAlign: 'left' }}>{ch.title}</b>
                  <span className="small muted">{ch.topics.length} topics · {ch.counts.coding} coding · {ch.counts.interview} int.</span>
                  <span className="ringwrap"><ProgressRing pct={pct} size={34} /></span>
                </button>

                {open && (
                  <div className="tree-topics" role="treeitem">
                    {ch.topics.map((tp) => {
                      const st = topicMark(ch, tp, sec);
                      const mark = st === 'done' ? '✓' : st === 'review' ? '↻' : st === 'current' ? '●' : '○';
                      const color = st === 'done' ? 'var(--green)' : st === 'review' ? 'var(--amber)' : 'var(--muted)';
                      return (
                        <button
                          key={tp.id}
                          className="tree-row topic"
                          onClick={() => sec && nav(`/lesson/${sec.id}/learn`)}
                          onKeyDown={(e) => { if (e.key === 'Enter') sec && nav(`/lesson/${sec.id}/learn`); }}
                        >
                          <span className="mark" style={{ color }}>{mark}</span>
                          <span style={{ flex: 1, textAlign: 'left' }}>{tp.title}</span>
                          {tp.level === 'advanced' && <span className="chip">ADV</span>}
                          {tp.importance === 'must_know' && <span className="chip" title="Must Know">🔥</span>}
                          {tp.hasCode && <span className="chip" title="Runnable example">▶</span>}
                          {ch.pdfPage && <Link className="chip" to={`/pdf/${ch.pdfPage}`} onClick={(e) => e.stopPropagation()}><FileText size={11} /> p.{ch.pdfPage}</Link>}
                        </button>
                      );
                    })}
                    <div className="tree-footer">
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <span className="chip">🔥 Must Know: {ch.counts.concepts}</span>
                        <span className="chip">💻 Coding: {ch.counts.coding}</span>
                        <span className="chip">🎤 Interview: {ch.counts.interview}</span>
                        <span className="chip">🏗️ Projects: {ch.counts.projects}</span>
                        <span className="chip">📊 Mastery: {pct}%</span>
                      </div>
                      <div className="row" style={{ marginTop: 8 }}>
                        {sec
                          ? <Link className="btn small primary" to={`/lesson/${sec.id}/learn`}>Open Topic → Learn</Link>
                          : <button className="btn small primary" disabled>Open Topic → Learn</button>}
                        <Link className="btn small" to={`/lesson/${ch.id}/coding`}>Practice</Link>
                        <Link className="btn small" to={`/lesson/${ch.id}/interview`}>Interview</Link>
                        <Link className="btn small" to={`/lesson/${ch.id}/mini`}>Mini Project</Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* TRACK footer: next best + progress */}
      <div className="path-grid" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="row spread">
            <h2 className="row" style={{ gap: 8, margin: 0 }}><Target size={16} color="var(--cyan)" /> Track Progress</h2>
            <span className="chip">{overall}%</span>
          </div>
          <Bar pct={overall} />
          <div className="row spread small muted" style={{ marginTop: 8 }}>
            <span>{doc.chapters.filter((ch) => (chapterPct[ch.id] ?? 0) >= 100).length}/{doc.chapters.length} chapters complete</span>
            <span>~{doc.estimatedHours}h total</span>
          </div>
        </div>
        {nba && firstSec && (
          <div className="card">
            <div className="row spread">
              <h2 className="row" style={{ gap: 8, margin: 0 }}><Lightbulb size={16} color="var(--amber)" /> Next Best (in this track)</h2>
            </div>
            <b className="small">{nba.label}</b>
            <p className="small muted" style={{ margin: '4px 0 8px' }}>{nba.reason}</p>
            <Link className="btn small primary" to={nba.route}>Start →</Link>
          </div>
        )}
        {(backLinks.length > 0 || forwardLinks.length > 0) && (
          <div className="card">
            <h2 className="row" style={{ gap: 8, margin: 0 }}><Compass size={16} color="var(--cyan)" /> Related tracks</h2>
            {backLinks.length > 0 && (
              <>
                <div className="small muted" style={{ marginTop: 8 }}>Recommended before this one</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {backLinks.map((r) => (
                    <Link key={r.id} className="chip" to={r.to}>{r.label}</Link>
                  ))}
                </div>
              </>
            )}
            {forwardLinks.length > 0 && (
              <>
                <div className="small muted" style={{ marginTop: 10 }}>
                  {unlocks.length > 0 ? 'This one opens up' : 'Next up in the roadmap'}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {forwardLinks.map((r) => (
                    <Link key={r.id} className="chip" to={r.to}>{r.label}</Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Unused placeholder to keep import shape stable if TRACK_DEFS icon needed later. */
export type { TrackDoc };
