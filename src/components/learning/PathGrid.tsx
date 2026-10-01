import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Route } from 'lucide-react';
import { ProgressRing } from '../ui/ui';
import { SurfaceLogo } from '../shared/SurfaceLogo';
import { useI18n } from '../../app/i18n';
import { NAV } from '../../app/App';
import { EXTRA_PATHS, GROUP_KEY, PATH_GROUPS, pathStat, pathTotals, type PathGroup } from '../../core/learning/paths';
import { STEP_COUNT } from '../../core/learning/roadmap';
import { ARCHIVE_LABEL_KEY, ARCHIVE_ROUTE, SURFACE_FAMILIES, SURFACE_GLYPH, family, familySize } from '../../core/learning/surfaces';
import { usePathCtx } from '../../core/data/paths';
import type { LocaleKey } from '../../app/i18n/locales';

/**
 * Every other path in the project, as the CONTINUATION of the master roadmap.
 *
 * The roadmap used to stop at the 8 tracks, which meant the Playbook V15 layer, the question bank,
 * the labs and the career tools were reachable only from the sidebar — a learner had to know the
 * sidebar's filing system to find the thing they wanted to do next. These steps carry the road on:
 * same rail, same numbered nodes, same arrowheads, numbered on from the last step of the master
 * roadmap (37 … 61). The number is not decoration: two steps sharing a node is the layout saying
 * "these are the same kind of thing" about two different kinds of thing.
 *
 * They are COMPACT steps and not eight more full-size boxes, and that is the design decision:
 * 25 cards of equal weight beside 8 track cards said the two groups were the same kind of thing and
 * left the reading order of a wrapped grid zig-zagging. One line each, with the four families as
 * dividers ON the spine, makes the order the layout — and the page grows by nothing.
 *
 * `engine/paths.ts` owns the list AND the rule that no route may go missing (its EXTRA_PATHS +
 * PATH_ROUTE_ALLOWLIST are diffed against App.tsx by the test), so this file only renders.
 */

/*
 * The four families' tones come from the surface registry, not from here: the same four families are
 * named on the family band above and on the Learning Path's own headings, and a colour that lives
 * in two places is a colour that drifts. The `TONE[group]` shape stays because the classes it feeds
 * are what lines these rows up with the master spine.
 */
const TONE: Record<PathGroup, string> = {
  practice: family('practice').tone,
  lab: family('lab').tone,
  career: family('career').tone,
  reference: family('reference').tone,
};

/** Where the master roadmap ends — the extra paths are numbered on from there. */
const FIRST_EXTRA_NO = STEP_COUNT + 1;

/** Facts shown on the row; the rest live in the `+N` chip's tooltip rather than a third line. */
const FACT_LIMIT = 3;

export default function PathGrid() {
  const { t } = useI18n();
  const ctx = usePathCtx();
  const totals = pathTotals(ctx);
  const rated = EXTRA_PATHS.filter((d) => pathStat(d, ctx).pct !== null).length;
  const lastRoute = EXTRA_PATHS[EXTRA_PATHS.length - 1]?.route;

  return (
    <div className="path-extra">
      {/*
       * The five families, as five tiles.
       *
       * This is the page's answer to "what is this platform?": one master path of 36 steps, and four
       * support families around it — practice, labs & build, career, reference — 61 surfaces in
       * total and not 61 competing journeys. Each tile carries the marks of the family it names, so
       * the visual language of the cards below is introduced before the first card: a learner finds
       * a mark here and meets it again on the surface it identifies.
       */}
      <div className="fam-band">
        {SURFACE_FAMILIES.map((f) => (
          <div key={f.id} className={`fam-tile tone-${f.tone}`}>
            <span className="fam-marks" aria-hidden="true">
              {f.id === 'master'
                ? <SurfaceLogo id="compass" size={20} />
                : EXTRA_PATHS.filter((d) => d.group === (f.id as PathGroup)).slice(0, 3)
                  .map((d) => <SurfaceLogo key={d.route} id={SURFACE_GLYPH[d.route]} size={17} />)}
            </span>
            <b className="fam-name">{t(f.key as LocaleKey)}</b>
            <span className="fam-span">
              {String(f.first).padStart(2, '0')}–{String(f.last).padStart(2, '0')}
              {' · '}{familySize(f.id)} {t('path.famSurfaces')}
            </span>
          </div>
        ))}
      </div>

      <div className="rmap-head">
        <h3 className="row" style={{ gap: 8, margin: 0 }}>
          <Route size={16} color="var(--violet)" /> {t('path.moreTitle')}
        </h3>
        <span className="small muted" style={{ maxWidth: 640 }}>{t('path.moreSub')}</span>
        <div className="rmap-legend">
          {/* The support span on the heading, so "Additional Paths (37–61)" is stated rather than
              inferred from the rail's last node. */}
          <span className="chip">{`${String(family('practice').first)}–${String(family('reference').last)}`}</span>
          <span className="chip">{EXTRA_PATHS.length} {t('path.morePaths')}</span>
          <span className="chip">{rated} {t('path.moreRated')}</span>
          <ProgressRing pct={totals.pct} size={38} label={`${totals.done} / ${totals.total}`} />
        </div>
      </div>

      <div className="rmap">
        {PATH_GROUPS.map((group) => {
          const defs = EXTRA_PATHS.filter((d) => d.group === group);
          if (!defs.length) return null;
          return (
            <Fragment key={group}>
              {/* A family is a phase of the same road, not a new list: the divider IS a step of the
                  spine (the line runs through it), so the numbering never restarts. */}
              <div className={`rmap-group tone-${TONE[group]}`}>
                <div className="rmap-rail" aria-hidden="true"><span className="rmap-line" /></div>
                <div className="rmap-group-body">
                  <span className="chip">{t(GROUP_KEY[group] as LocaleKey)}</span>
                  <span className="small muted">{defs.length} {t('path.morePaths')}</span>
                </div>
              </div>

              {defs.map((def) => {
                const no = String(EXTRA_PATHS.indexOf(def) + FIRST_EXTRA_NO).padStart(2, '0');
                const nav = NAV.find((n) => n.to === def.route);
                // Practice Archive, never "Playbook V15": the imported set is 476 practice items the
                // master path teaches, not a second product. Its provenance stays `source: 'v15'`
                // internally — a learner is never asked to care which migration it came from.
                const label = def.route === ARCHIVE_ROUTE
                  ? t(ARCHIVE_LABEL_KEY)
                  : (nav?.label ?? (def.labelKey ? t(def.labelKey as LocaleKey) : def.route));
                const stat = pathStat(def, ctx);
                const facts = def.facts(ctx);
                const shown = facts.slice(0, FACT_LIMIT);
                const hidden = facts.length - shown.length;
                const last = def.route === lastRoute;
                return (
                  <div key={def.route} className={`rmap-step tone-${TONE[group]}`}>
                    <div className="rmap-rail" aria-hidden="true">
                      <span className="rmap-dot">{no}</span>
                      {!last && <span className="rmap-line" />}
                      {!last && <span className="rmap-arrow"><ChevronDown size={12} /></span>}
                    </div>
                    <Link className="path-card" to={def.route}>
                      {/* The mark is the surface's own identity from the registry, not a generic
                          glyph: the same timer, shield and refresh appear in the command palette,
                          the search index and the sidebar, so a learner reads one mark per idea. */}
                      <span className="pc-ic"><SurfaceLogo id={SURFACE_GLYPH[def.route]} size={17} /></span>
                      <b className="pc-name">{label}</b>
                      <span className="pc-facts">
                        {shown.map((f) => <span key={f} className="chip">{f}</span>)}
                        {hidden > 0 && <span className="chip" title={facts.join(' · ')}>+{hidden}</span>}
                      </span>
                      {/* The right end is the one place a row says something it cannot say in facts:
                          either the real figure, or that there is no denominator and the row is a
                          door. `.pc-tail` keeps it there even when the facts wrap. */}
                      <span className="pc-tail">
                        {stat.pct !== null ? (
                          <>
                            <ProgressRing pct={stat.pct} size={30} />
                            <span className="pc-stat">{stat.note}</span>
                          </>
                        ) : (
                          <span className="pc-stat">{t('path.moreOpen')} →</span>
                        )}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </Fragment>
          );
        })}
      </div>

      <p className="small muted" style={{ margin: '12px 0 0' }}>{t('path.moreNote')}</p>
    </div>
  );
}
