import { Link } from 'react-router-dom';
import { BookMarked, FileText, Route } from 'lucide-react';
import { Bar, ProgressRing } from './ui';
import { useI18n } from '../i18n';
import { NAV } from '../App';
import { EXTRA_PATHS, GROUP_KEY, PATH_GROUPS, pathStat, pathTotals, type PathGroup } from '../engine/paths';
import { usePathCtx } from '../data/paths';
import type { LocaleKey } from '../i18n/locales';

/**
 * Every other path in the project, next to the 8 curriculum tracks.
 *
 * The roadmap used to stop at the tracks, which meant the Playbook V15 layer, the question bank,
 * the labs and the career tools were reachable only from the sidebar — a learner had to know the
 * sidebar's filing system to find the thing they wanted to do next. These cards are the same
 * "path" idea applied to the rest of the app: numbered on from the 8 tracks (09 …), one card per
 * destination, each with a number read from a manifest or from learner state.
 *
 * `engine/paths.ts` owns the list AND the rule that no route may go missing (its EXTRA_PATHS +
 * PATH_ROUTE_ALLOWLIST are diffed against App.tsx by the test), so this file only renders.
 */

const TONE: Record<PathGroup, string> = {
  practice: 'cyan', lab: 'violet', career: 'amber', reference: 'blue',
};

/** Where the 8 tracks end — the extra paths are numbered on from here. */
const FIRST_EXTRA_NO = 9;

export default function PathGrid() {
  const { t } = useI18n();
  const ctx = usePathCtx();
  const totals = pathTotals(ctx);
  const rated = EXTRA_PATHS.filter((d) => pathStat(d, ctx).pct !== null).length;

  return (
    <div className="card fadeup" style={{ marginTop: 16 }}>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 className="row" style={{ gap: 8, margin: 0 }}>
            <Route size={16} color="var(--violet)" /> {t('path.moreTitle')}
          </h3>
          <p className="muted small" style={{ maxWidth: 760, margin: '4px 0 0' }}>{t('path.moreSub')}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip">{EXTRA_PATHS.length} {t('path.morePaths')}</span>
          <span className="chip">{rated} {t('path.moreRated')}</span>
          <ProgressRing pct={totals.pct} size={42} label={`${totals.done} / ${totals.total}`} />
        </div>
      </div>

      {PATH_GROUPS.map((group) => {
        const defs = EXTRA_PATHS.filter((d) => d.group === group);
        if (!defs.length) return null;
        return (
          <div key={group}>
            <div className="more-head">
              <span className="chip tone-cyan">{t(GROUP_KEY[group] as LocaleKey)}</span>
              <span className="small muted">{defs.length}</span>
            </div>
            <div className="more-grid">
              {defs.map((def) => {
                const no = String(EXTRA_PATHS.indexOf(def) + FIRST_EXTRA_NO).padStart(2, '0');
                const nav = NAV.find((n) => n.to === def.route);
                const label = nav?.label ?? (def.labelKey ? t(def.labelKey as LocaleKey) : def.route);
                const Icon = nav?.icon ?? (def.route.includes('pdf') ? FileText : BookMarked);
                const stat = pathStat(def, ctx);
                return (
                  <Link key={def.route} className={`path-card tone-${TONE[def.group]}`} to={def.route}>
                    <div className="pc-head">
                      <span className="pc-num">{no}</span>
                      <span className="pc-ic"><Icon size={15} /></span>
                      <b className="pc-name">{label}</b>
                      {stat.pct !== null && <ProgressRing pct={stat.pct} size={32} />}
                    </div>
                    <div className="pc-facts">
                      {def.facts(ctx).map((f) => <span key={f} className="chip">{f}</span>)}
                    </div>
                    <div className="pc-foot">
                      {stat.pct !== null ? (
                        <>
                          <Bar pct={stat.pct} />
                          <span className="pc-stat">{stat.note}</span>
                        </>
                      ) : (
                        <span className="pc-stat">{t('path.moreOpen')} →</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="small muted" style={{ margin: '12px 0 0' }}>{t('path.moreNote')}</p>
    </div>
  );
}
