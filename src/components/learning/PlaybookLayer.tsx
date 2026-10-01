import { Link } from 'react-router-dom';
import { BookMarked, FileText, ListChecks, Mic2 } from 'lucide-react';
import { SurfaceLogo } from '../shared/SurfaceLogo';
import { useI18n } from '../../app/i18n';
import { useCurriculum } from '../../core/data/curriculum';
import type { PlaybookCoverage } from '../../core/data/playbook';

/**
 * Playbook V15 on the Learning Path.
 *
 * This is not a banner for the document — it is the layer's coverage report. The 477 imported
 * items went into the bank of the section they belong to, so the only honest way to show them on
 * the path is per track: how much of the document reached this track, and how much of THAT the
 * learner has practised. A track the document never reached says so in plain words; it is never
 * silently dropped from the list and never gets a 0% ring it did not earn.
 *
 * Coverage comes from `core/assessment/playbook.ts` (pure, tested) reading `public/generated/playbook/*.json` plus
 * real learner state, and is handed down by LearningPath — which needs the same rows for its
 * track cards and its rail.
 */
export default function PlaybookLayer({ coverage }: { coverage: PlaybookCoverage }) {
  const { t } = useI18n();
  const { sections } = useCurriculum();
  const { index, rows, touched, total, ready } = coverage;

  if (!index) {
    return (
      <div className="card pb-band">
        <div className="row spread">
          <h3 className="row" style={{ gap: 8, margin: 0 }}>
            <BookMarked size={16} color="var(--cyan)" /> {t('path.pbTitle')}
          </h3>
          <span className="small muted">{t('path.pbLoading')}</span>
        </div>
      </div>
    );
  }

  const tot = index.totals;
  const sectionsCovered = Object.keys(tot.bySection).length;
  const tracksCovered = rows.filter((r) => r.items > 0).length;
  const miniProjects = tot.miniProjectBlueprints + tot.miniProjectCapstones;

  /**
   * The sections that received the document's coding labs (chapter 15) and its mini projects
   * (chapter 17), read from the manifest's own chapter → section map. Hard-coding s28/s29 would
   * keep pointing at the old home if the import were ever re-routed.
   */
  const sectionOfChapter = (no: string) => index.chapters.find((c) => c.no === no)?.sectionId ?? null;
  const labSection = sectionOfChapter('15');
  const projectSection = sectionOfChapter('17');

  return (
    <div className="card glow fadeup pb-band">
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="row small muted" style={{ gap: 6, marginBottom: 6 }}>
            <span className="chip">SECOND SOURCE</span>
            <span className="chip">{index.pages} {t('path.pbPages')}</span>
            <span className="chip">{index.chapters.length} {t('path.pbChapters')}</span>
            {/* `total` is items.json — what the banks actually took. The manifest's own item count
                records what the DOCUMENT offered, which is one higher: one question was refused on
                import as a cross-bank duplicate. The learner's numbers come from the banks. */}
            <span className="chip">{total} {t('path.pbItems')}</span>
            {/* The document's own two derived columns. They used to head the per-track V15 grid;
                that grid is now inside each track's step in the roadmap, so the only place these
                totals belong is here, with the rest of what the layer as a whole can say. */}
            <span className="chip">{tot.complexityRows} {t('path.pbComplexity')}</span>
            <span className="chip">{tot.logicSteps} {t('path.pbLogic')}</span>
          </div>
          <h3 className="row" style={{ gap: 8, margin: '4px 0' }}>
            <BookMarked size={17} color="var(--cyan)" /> {t('path.pbTitle')}
          </h3>
          <p className="muted small" style={{ maxWidth: 760, margin: 0 }}>{t('path.pbSub')}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip easy">{touched}/{total} {t('path.pbPractised')}</span>
          {coverage.target ? (
            <Link className="btn small primary" to={`/questions?section=${coverage.target.sectionId}&playbook=1`}>
              <ListChecks size={13} /> {t('path.pbNext')} · {String(coverage.target.no).padStart(2, '0')}
            </Link>
          ) : ready ? <span className="chip easy">✓ {t('path.pbAllDone')}</span> : null}
        </div>
      </div>

      <div className="pb-stats">
        <div className="stat"><div className="n">{total}</div><div className="l">{t('path.pbItems')}</div></div>
        <div className="stat"><div className="n">{sectionsCovered}</div><div className="l">{t('path.pbCovered')} ({sections.length})</div></div>
        <div className="stat"><div className="n">{tracksCovered}</div><div className="l">{t('path.pbTracks')} ({rows.length})</div></div>
        <div className="stat"><div className="n">{tot.labs}</div><div className="l">{t('path.pbLabs')}</div></div>
        <div className="stat"><div className="n">{miniProjects}</div><div className="l">{t('path.pbProjects')}</div></div>
        <div className="stat"><div className="n">{tot.methodAnswers}</div><div className="l">{t('path.pbMethods')}</div></div>
      </div>

      {/*
        The per-track coverage rows are NOT here — a track's V15 share is an inset panel inside
        that track's own step in the roadmap above (`.rmap-pb`), so the roadmap has one box per
        track instead of two. What is left here is what only the layer as a whole can say: its
        totals, and where to push it next.
      */}

      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        {/* Marks, not emoji: `code` and `cube` are the same two glyphs the Code Playground and
            Projects carry on the support band below, so the reader meets one mark per idea. */}
        {labSection && (
          <Link className="btn small" to={`/lesson/${labSection}/coding`}>
            <SurfaceLogo id="code" size={13} /> {tot.labs} {t('path.pbLabs')}
          </Link>
        )}
        {projectSection && (
          <Link className="btn small" to={`/lesson/${projectSection}/mini`}>
            <SurfaceLogo id="cube" size={13} /> {miniProjects} {t('path.pbProjects')}
          </Link>
        )}
        <Link className="btn small" to="/questions?playbook=1"><BookMarked size={13} /> {t('path.pbPractice')}</Link>
        <Link className="btn small" to="/pdf/playbook"><FileText size={13} /> {t('path.pbRead')}</Link>
        <Link className="btn small" to="/interview"><Mic2 size={13} /> {t('path.pbInterviewMode')}</Link>
      </div>

      <p className="small muted" style={{ margin: '10px 0 0' }}>{t('path.pbMethodNote')}</p>
    </div>
  );
}
