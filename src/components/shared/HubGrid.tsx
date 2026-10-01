import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { EXTRA_PATHS, pathStat } from '../../core/learning/paths';
import { usePathCtx } from '../../core/data/paths';
import { NAV } from '../../app/App';
import { ProgressRing } from '../ui/ui';

/**
 * The shared card grid every pillar hub renders.
 *
 * A hub is not a second registry. The routes, their labels and icons, their facts and their honest
 * percentages all come from the SAME owners the Learning Path reads: `core/learning/paths.ts`
 * for the card data, `NAV` for the label/icon (the sidebar and the roadmap read it too), and
 * `core/data/paths.ts` for the numbers. A hub therefore cannot describe a page differently
 * from the sidebar, and a page can never become unreachable by being left out of a hub — the
 * route registry test still guards that.
 */
export function HubGrid({ routes }: { routes: string[] }) {
  const ctx = usePathCtx();
  const defs = routes
    .map((r) => EXTRA_PATHS.find((d) => d.route === r))
    .filter((d): d is (typeof EXTRA_PATHS)[number] => !!d);

  return (
    <div className="tile-grid hub-grid">
      {defs.map((def) => {
        const nav = NAV.find((n) => n.to === def.route);
        const Icon = nav?.icon ?? ChevronRight;
        const label = nav?.label ?? def.route;
        const stat = pathStat(def, ctx);
        const facts = def.facts(ctx);
        return (
          <Link key={def.route} to={def.route} className="tile" title={facts.join(' · ')}>
            <span className="ic"><Icon size={18} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b>{label}</b>
              <span>{facts.slice(0, 2).join(' · ')}</span>
            </span>
            {stat.pct !== null ? (
              <span className="row" style={{ gap: 6, flex: 'none' }}>
                <ProgressRing pct={stat.pct} size={32} />
                <span className="small muted">{stat.note}</span>
              </span>
            ) : (
              <ChevronRight size={15} className="muted" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
