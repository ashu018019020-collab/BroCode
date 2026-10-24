import { Link } from 'react-router-dom';
import { Route } from 'lucide-react';
import { ProgressRing } from '../ui/ui';
import { SurfaceLogo } from '../shared/SurfaceLogo';
import { useI18n } from '../../app/i18n';
import { NAV } from '../../app/App';
import { EXTRA_PATHS, GROUP_KEY, PATH_GROUPS, pathStat, pathTotals, type PathGroup } from '../../core/learning/paths';
import { ARCHIVE_LABEL_KEY, ARCHIVE_ROUTE, SURFACE_FAMILIES, SURFACE_GLYPH, family, familySize } from '../../core/learning/surfaces';
import { usePathCtx } from '../../core/data/paths';
import type { LocaleKey } from '../../app/i18n/locales';

/**
 * The platform's capabilities — everything the COURSE uses, grouped by family and NOT numbered.
 *
 * This band used to continue the master rail's numbering (37 … 60), which made a real claim that was
 * wrong: it said the Question Bank, the labs, the career tools and the reference books were the 37th
 * to 60th steps of the same course. They are not steps. Every item inside them is already tagged to a
 * course chapter — `scripts/courses.cjs` files all 14,551 of them, and `npm run course:audit` proves
 * every ref resolves — so the practice, the lab, the interview question and the PDF page a learner
 * needs ARE inside the chapter they are studying (`/course/<slug>/<step>`, seven tabs). What remains
 * here is the global door to each capability, for the learner who wants to drill a whole family.
 *
 * So the numbering is gone: the COURSE index is 1…36, and an entry in it is a step a learner can be
 * taught. A capability has no place in that sequence, and giving it one meant two different kinds of
 * thing shared the same numbering. The rows keep their real figures, their marks and their families
 * — only the claim to be a step is dropped.
 *
 * NOT MOUNTED right now: the courses home used to render this band under the course grid, and that
 * page is the eleven cards alone. The component is kept (the routes are still in the sidebar and on
 * the four hub pages) until it is given a hub of its own — the guard in `scripts/tests/layout.test.mjs`
 * holds it off the first page, not out of the repository.
 *
 * `engine/paths.ts` owns the list AND the rule that no route may go missing (its EXTRA_PATHS +
 * PATH_ROUTE_ALLOWLIST are diffed against App.tsx by the test), so this file only renders.
 */

/*
 * The four families' tones come from the surface registry, not from here: the same four families are
 * named in `core/learning/surfaces.ts` and drawn on the hub grids, and a colour that lives in two
 * places is a colour that drifts. The `TONE[group]` shape stays because the classes it feeds are what
 * makes four families read as four families.
 */
const TONE: Record<PathGroup, string> = {
  practice: family('practice').tone,
  lab: family('lab').tone,
  career: family('career').tone,
  reference: family('reference').tone,
};

/** Facts shown on the row; the rest live in the `+N` chip's tooltip rather than a third line. */
const FACT_LIMIT = 3;

export default function PathGrid() {
  const { t } = useI18n();
  const ctx = usePathCtx();
  const totals = pathTotals(ctx);
  const rated = EXTRA_PATHS.filter((d) => pathStat(d, ctx).pct !== null).length;

  return (
    <div className="path-extra">
      {/*
       * The five families, as five tiles.
       *
       * This is the page's answer to "what is this platform?": a course of 36 steps, and the four
       * capability families it uses — practice, labs & build, career, reference. Each tile carries
       * the marks of the family it names, so the visual language of the rows below is introduced
       * before the first row: a learner finds a mark here and meets it again on the surface it
       * identifies.
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
            {/* The count, not a number RANGE: "37–60" was the support band claiming a place in the
                course index, which is the thing this pass removed. */}
            <span className="fam-span">{familySize(f.id)} {t('path.famSurfaces')}</span>
          </div>
        ))}
      </div>

      <div className="rmap-head">
        <h2 className="row" style={{ gap: 8, margin: 0 }}>
          <Route size={16} color="var(--violet)" /> {t('path.moreTitle')}
        </h2>
        <span className="small muted" style={{ maxWidth: 640 }}>{t('path.moreSub')}</span>
        <div className="rmap-legend">
          <span className="chip">{EXTRA_PATHS.length} {t('path.morePaths')}</span>
          <span className="chip">{rated} {t('path.moreRated')}</span>
          <ProgressRing pct={totals.pct} size={38} label={`${totals.done} / ${totals.total}`} />
        </div>
      </div>

      <div className="cap-grid">
        {PATH_GROUPS.map((group) => {
          const defs = EXTRA_PATHS.filter((d) => d.group === group);
          if (!defs.length) return null;
          return (
            <div key={group} className={`cap-group tone-${TONE[group]}`}>
              {/* A family, not a phase of the road: no node, no spine, no number — the divider is a
                  heading with the count of what is behind it. */}
              <div className="cap-head">
                <span className="chip">{t(GROUP_KEY[group] as LocaleKey)}</span>
                <span className="small muted">{defs.length} {t('path.morePaths')}</span>
              </div>
              <div className="cap-rows">
              {defs.map((def) => {
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
                return (
                  <Link key={def.route} className={`path-card tone-${TONE[group]}`} to={def.route}>
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
                );
              })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="small muted" style={{ margin: '12px 0 0' }}>{t('path.moreNote')}</p>
    </div>
  );
}
