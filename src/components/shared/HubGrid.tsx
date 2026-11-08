import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { EXTRA_PATHS, pathStat } from '../../core/learning/paths';
import { usePathCtx } from '../../core/data/paths';
import { SURFACE_GLYPH } from '../../core/learning/surfaces';
import { NAV } from '../../app/App';
import { ProgressRing } from '../ui/ui';
import { SurfaceLogo } from './SurfaceLogo';

/**
 * The shared card grid every pillar hub renders.
 *
 * A hub is not a second registry. The routes, their labels and icons, their facts and their honest
 * percentages all come from the SAME owners the Learning Path reads: `core/learning/paths.ts`
 * for the card data, `NAV` for the label (the sidebar and the roadmap read it too),
 * `SURFACE_GLYPH` for the mark, and `core/data/paths.ts` for the numbers. A hub therefore cannot
 * describe a page differently from the sidebar, and a page can never become unreachable by being
 * left out of a hub — the route registry test still guards that.
 *
 * The card itself is the pillar tile (`.tile-pillar`): a lit well holding the surface's own mark at
 * 26px, the name, one line of real facts, and the figure the card exists to show. The previous card
 * was an 18px lucide glyph beside 0.84rem text, which made a hub read as a list of rows next to the
 * subject cards sitting above it. Marks come from the one 36-glyph registry rather than a second set
 * of drawings, so "interview questions" is the same mark in the sidebar, the practice hub and here.
 */
const TONES = ['tone-cyan', 'tone-violet', 'tone-green', 'tone-amber', 'tone-fuchsia', 'tone-orange'];

/**
 * A tile's accent, taken in order around the palette. Presentation only: the tone says "these are
 * different destinations", never "this one is better", and it is assigned by position so two
 * neighbouring cards never share a colour.
 */
export const pillarTone = (i: number) => TONES[i % TONES.length];

export function HubGrid({ routes }: { routes: string[] }) {
  const ctx = usePathCtx();
  const defs = routes
    .map((r) => EXTRA_PATHS.find((d) => d.route === r))
    .filter((d): d is (typeof EXTRA_PATHS)[number] => !!d);

  return (
    <div className="tile-grid hub-grid tile-grid-pillar">
      {defs.map((def, i) => {
        const nav = NAV.find((n) => n.to === def.route);
        const label = nav?.label ?? def.route;
        const stat = pathStat(def, ctx);
        const facts = def.facts(ctx);
        return (
          <Link
            key={def.route}
            to={def.route}
            className={`tile tile-pillar ${pillarTone(i)}`}
            title={facts.join(' · ')}
          >
            <span className="ic"><SurfaceLogo id={SURFACE_GLYPH[def.route] ?? 'layers'} size={26} /></span>
            <span className="t">
              <b>{label}</b>
              <span className="tile-facts">{facts.slice(0, 2).join(' · ')}</span>
            </span>
            {stat.pct !== null ? (
              <span className="tile-metric">
                <ProgressRing pct={stat.pct} size={34} />
                <span className="small muted">{stat.note}</span>
              </span>
            ) : (
              <ChevronRight size={16} className="muted" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
